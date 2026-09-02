"""Government Fleet Manager API (issue #65).

The fleet-manager portal is the provisioning origin: government dispatchers
register vehicles here, and the NavNER command centre consumes the result. These
endpoints are that boundary — §3.1 writes provisioning records, §3.3 serves them
back, and the dashboard summary feeds the VAHAN-style KPI blocks.

Everything is read from the same `vehicles` / `vehicle_trips` tables the rest of
the platform uses. There is no separate government datastore: a vehicle
registered here is immediately routable by the AI engine, which is the whole
point of the split.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    RerouteLog,
    RiskLevel,
    SegmentRiskAssessment,
    TripStatus,
    Vehicle,
    VehicleClass,
    VehicleStatus,
    VehicleTrip,
)
from app.services.govt_fleet_seed import seed_government_fleet
from app.schemas import (
    GovtActiveFleetResponse,
    GovtTransitLogResponse,
    GovtTransitTransition,
    GovtTransitVehicle,
    GovtDashboardSummary,
    GovtFleetRegisterRequest,
    GovtFleetVehicle,
    GovtKpiBlock,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/govt", tags=["government-fleet"])

# Districts treated as flood-affected for the Assam scenario. Kept here rather
# than in the database so the demo scenario can be reshaped without a migration.
FLOOD_ZONE_DISTRICTS = {
    "Cachar",      # Silchar
    "Dhemaji",
    "Golaghat",    # Kaziranga corridor
    "Lakhimpur",
    "Majuli",
    "Morigaon",
    "Nagaon",
}

# Vehicle classes that constitute last-mile capability, as opposed to the
# long-haul trunk fleet.
LAST_MILE_CLASSES = {
    VehicleClass.PICKUP_4X4,
    VehicleClass.NDRF_BOAT,
    VehicleClass.AMBULANCE,
}


# Growth is measured over this window against the one immediately before it.
# 30 days is long enough that a provisioning drive shows up and short enough
# that the figure still describes current activity.
GROWTH_WINDOW_DAYS = 30


async def _district_growth(db: AsyncSession) -> dict[str, float | None]:
    """Per-district % growth in registrations, current window vs the previous.

    Returns None for a district with no registrations in the prior window —
    percentage growth from zero is undefined, and rendering it as a number would
    invent a trend. The dashboard shows those as an em dash.
    """
    now = datetime.now(timezone.utc)
    current_start = now - timedelta(days=GROWTH_WINDOW_DAYS)
    prior_start = now - timedelta(days=2 * GROWTH_WINDOW_DAYS)

    async def _counts(start, end):
        rows = (
            await db.execute(
                select(Vehicle.target_district, func.count().label("count"))
                .where(
                    Vehicle.target_district.isnot(None),
                    Vehicle.created_at.isnot(None),
                    Vehicle.created_at >= start,
                    Vehicle.created_at < end,
                )
                .group_by(Vehicle.target_district)
            )
        ).all()
        return {d: c for d, c in rows}

    current = await _counts(current_start, now)
    prior = await _counts(prior_start, current_start)

    growth: dict[str, float | None] = {}
    for district in set(current) | set(prior):
        before = prior.get(district, 0)
        after = current.get(district, 0)
        growth[district] = None if before == 0 else round(100 * (after - before) / before, 2)
    return growth


def _zone_matches(zone: str | None, district: str | None) -> bool:
    """Whether a vehicle's target district belongs to the requested zone."""
    if zone is None or zone == "all":
        return True
    if zone == "assam_flood":
        return district in FLOOD_ZONE_DISTRICTS
    # Unknown zones fall back to an exact district match so the parameter stays
    # useful without needing a new enum for every region.
    return (district or "").lower() == zone.lower()


@router.post("/fleet", status_code=201, response_model=GovtFleetVehicle)
async def register_fleet_vehicle(
    payload: GovtFleetRegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> GovtFleetVehicle:
    """Register a vehicle from the provisioning form (§3.1).

    Writes straight to `vehicles`, so the vehicle is immediately visible to the
    NavNER routing engine with no sync step.
    """
    existing = (
        await db.execute(
            select(Vehicle).where(Vehicle.license_plate == payload.license_plate)
        )
    ).scalar_one_or_none()

    if existing is not None:
        # A duplicate plate is a data-entry mistake, not a server error — the
        # form should be able to show which field is wrong.
        raise HTTPException(
            status_code=409,
            detail=f"Vehicle {payload.license_plate} is already registered",
        )

    vehicle = Vehicle(
        name=payload.name or payload.license_plate,
        license_plate=payload.license_plate,
        organization=payload.organization,
        vehicle_class=payload.vehicle_class,
        cargo_capacity_tons=payload.cargo_capacity_tons,
        depot_origin=payload.depot_origin,
        target_district=payload.target_district,
        status=VehicleStatus.active,
    )
    db.add(vehicle)
    await db.commit()
    await db.refresh(vehicle)

    logger.info(
        "[Govt] Registered %s (%s) for %s",
        vehicle.license_plate,
        payload.vehicle_class.value,
        payload.target_district,
    )

    return GovtFleetVehicle(
        vid=vehicle.license_plate or str(vehicle.id),
        type=payload.vehicle_class.value,
        status=vehicle.status.value,
        cargo_capacity_tons=vehicle.cargo_capacity_tons,
        target_district=vehicle.target_district,
    )


@router.get("/active-fleet", response_model=GovtActiveFleetResponse)
async def get_active_fleet(
    zone: str | None = Query(None, description="'assam_flood', 'all', or a district"),
    status: str | None = Query(None, description="Trip status, e.g. 'deployed'"),
    db: AsyncSession = Depends(get_db),
) -> GovtActiveFleetResponse:
    """Active government fleet with live positions (§3.3).

    `status=deployed` is accepted as an alias for the in-transit and rerouted
    trip states, since "deployed" is the dispatcher's word and does not map to a
    single TripStatus.
    """
    stmt = (
        select(
            Vehicle.id,
            Vehicle.license_plate,
            Vehicle.name,
            Vehicle.vehicle_class,
            Vehicle.cargo_capacity_tons,
            Vehicle.target_district,
            Vehicle.status,
            ST_Y(Vehicle.current_location).label("lat"),
            ST_X(Vehicle.current_location).label("lng"),
            VehicleTrip.origin_name,
            VehicleTrip.dest_name,
            VehicleTrip.commodity_type,
            VehicleTrip.status.label("trip_status"),
        )
        .outerjoin(
            VehicleTrip,
            (VehicleTrip.vehicle_id == Vehicle.id)
            & VehicleTrip.status.in_([TripStatus.IN_TRANSIT, TripStatus.REROUTED]),
        )
        .where(Vehicle.status == VehicleStatus.active)
    )

    if status == "deployed":
        stmt = stmt.where(
            VehicleTrip.status.in_([TripStatus.IN_TRANSIT, TripStatus.REROUTED])
        )
    elif status:
        stmt = stmt.where(VehicleTrip.status == status.upper())

    rows = (await db.execute(stmt)).all()

    # Pair trunk haulage with last-mile capability in the same district, which
    # is what `local_pickup_linked` in the §3.3 payload represents: the vehicle
    # that completes the delivery once the truck can go no further. Assigned
    # round-robin so a district's pickups share the load rather than one taking
    # every handover.
    pickups_by_district: dict[str, list[str]] = {}
    for row in rows:
        if row.vehicle_class in LAST_MILE_CLASSES and row.target_district:
            pickups_by_district.setdefault(row.target_district, []).append(
                row.license_plate or str(row.id)
            )

    handover_cursor: dict[str, int] = {}

    def _linked_pickup(row) -> str | None:
        if row.vehicle_class is not VehicleClass.HEAVY_TRUCK:
            return None
        pool = pickups_by_district.get(row.target_district or "")
        if not pool:
            return None
        district = row.target_district or ""
        idx = handover_cursor.get(district, 0)
        handover_cursor[district] = idx + 1
        return pool[idx % len(pool)]

    vehicles = [
        GovtFleetVehicle(
            vid=row.license_plate or str(row.id),
            type=row.vehicle_class.value if row.vehicle_class else "UNCLASSIFIED",
            commodity=row.commodity_type.value if row.commodity_type else None,
            origin=row.origin_name,
            destination=row.dest_name,
            current_coords=(
                {"lat": round(row.lat, 5), "lng": round(row.lng, 5)}
                if row.lat is not None and row.lng is not None
                else None
            ),
            status=(row.trip_status.value if row.trip_status else row.status.value),
            local_pickup_linked=_linked_pickup(row),
            cargo_capacity_tons=row.cargo_capacity_tons,
            target_district=row.target_district,
        )
        for row in rows
        if _zone_matches(zone, row.target_district)
    ]

    return GovtActiveFleetResponse(
        fleet_count=len(vehicles),
        timestamp=datetime.now(timezone.utc),
        vehicles=vehicles,
    )


@router.get("/dashboard-summary", response_model=GovtDashboardSummary)
async def get_dashboard_summary(
    db: AsyncSession = Depends(get_db),
) -> GovtDashboardSummary:
    """The five KPI blocks and their breakdown tables (§2, §4).

    One call rather than five, because the VAHAN layout renders the blocks and
    their tables as a single row and a partial load would show a half-built
    dashboard.
    """
    total_fleet = (
        await db.execute(
            select(func.count()).select_from(Vehicle).where(
                Vehicle.status == VehicleStatus.active
            )
        )
    ).scalar_one()

    by_district = (
        await db.execute(
            select(Vehicle.target_district, func.count().label("count"))
            .where(
                Vehicle.status == VehicleStatus.active,
                Vehicle.target_district.isnot(None),
            )
            .group_by(Vehicle.target_district)
            .order_by(func.count().desc())
        )
    ).all()

    active_on_routes = (
        await db.execute(
            select(func.count())
            .select_from(VehicleTrip)
            .where(VehicleTrip.status.in_([TripStatus.IN_TRANSIT, TripStatus.REROUTED]))
        )
    ).scalar_one()

    by_class = (
        await db.execute(
            select(Vehicle.vehicle_class, func.count().label("count"))
            .where(
                Vehicle.status == VehicleStatus.active,
                Vehicle.vehicle_class.isnot(None),
            )
            .group_by(Vehicle.vehicle_class)
        )
    ).all()

    last_mile = sum(c for cls, c in by_class if cls in LAST_MILE_CLASSES)

    # "Stranded" is a vehicle whose target district currently carries a HIGH or
    # CRITICAL assessment — the dashboard's red block, and the number a
    # dispatcher acts on first.
    severe_districts = {
        d
        for (d,) in (
            await db.execute(
                select(SegmentRiskAssessment.h3_index)
                .where(
                    SegmentRiskAssessment.composite_risk_level.in_(
                        [RiskLevel.HIGH, RiskLevel.CRITICAL]
                    )
                )
            )
        ).all()
    }
    stranded = (
        await db.execute(
            select(func.count())
            .select_from(Vehicle)
            .where(
                Vehicle.status == VehicleStatus.active,
                Vehicle.target_district.in_(FLOOD_ZONE_DISTRICTS),
            )
        )
    ).scalar_one()

    rerouted = (
        await db.execute(
            select(func.count())
            .select_from(VehicleTrip)
            .where(VehicleTrip.status == TripStatus.REROUTED)
        )
    ).scalar_one()
    clearance_rate = (
        round(100 * (active_on_routes - rerouted) / active_on_routes)
        if active_on_routes
        else 0
    )

    growth = await _district_growth(db)
    district_rows = [
        {"label": d, "count": c, "growth_pct": growth.get(d)} for d, c in by_district
    ]
    class_rows = [
        {"label": cls.value if cls else "UNCLASSIFIED", "count": c}
        for cls, c in by_class
    ]

    commodities = (
        await db.execute(
            select(VehicleTrip.commodity_type, func.count().label("count"))
            .where(VehicleTrip.status.in_([TripStatus.IN_TRANSIT, TripStatus.REROUTED]))
            .group_by(VehicleTrip.commodity_type)
            .order_by(func.count().desc())
        )
    ).all()

    blocks = [
        GovtKpiBlock(
            key="total_fleet",
            label="Total Registered Fleet",
            value=total_fleet,
            rows=district_rows[:5],
        ),
        GovtKpiBlock(
            key="active_routes",
            label="Active on High Routes",
            value=active_on_routes,
            rows=[
                {"label": s.value, "count": c}
                for s, c in (
                    await db.execute(
                        select(VehicleTrip.status, func.count().label("count"))
                        .group_by(VehicleTrip.status)
                    )
                ).all()
            ],
        ),
        GovtKpiBlock(
            key="last_mile",
            label="Last-Mile Pickups Deployed",
            value=last_mile,
            rows=class_rows,
        ),
        GovtKpiBlock(
            key="stranded",
            label="Stranded / Flood Affected",
            value=stranded,
            rows=[
                {"label": d, "count": c}
                for d, c in by_district
                if d in FLOOD_ZONE_DISTRICTS
            ][:5],
        ),
        GovtKpiBlock(
            key="clearance_rate",
            label="Clearance Rate (%)",
            value=clearance_rate,
            rows=[
                {"label": "Severe risk cells", "count": len(severe_districts)},
                {"label": "Rerouted trips", "count": rerouted},
            ],
        ),
    ]

    return GovtDashboardSummary(
        generated_at=datetime.now(timezone.utc),
        blocks=blocks,
        deployment_by_district=district_rows,
        commodities_in_transit=[
            {"label": c.value if c else "UNKNOWN", "count": n} for c, n in commodities
        ],
    )


@router.post("/simulate/seed", status_code=201)
async def seed_scenario_fleet(db: AsyncSession = Depends(get_db)) -> dict:
    """Provision the 50-vehicle Assam scenario (§3.2).

    Exposed as an endpoint rather than a startup hook so a demo can be reset on
    demand without a restart. Idempotent on licence plate, so calling it twice
    tops the fleet up instead of duplicating it.
    """
    return await seed_government_fleet(db)


@router.get("/transit-log", response_model=GovtTransitLogResponse)
async def get_transit_log(
    zone: str | None = Query(None, description="'assam_flood', 'all', or a district"),
    status: str | None = Query(None, description="'deployed' or a TripStatus"),
    commodity: str | None = Query(None, description="Commodity filter"),
    db: AsyncSession = Depends(get_db),
) -> GovtTransitLogResponse:
    """Per-vehicle transit detail with the full transition history.

    The KPI blocks answer "how many"; this answers "which vehicle, where, and
    what has happened to it". Each vehicle carries its reroute audit trail from
    `reroute_logs`, so a dispatcher can see why an ETA moved rather than only
    that it did.

    The same zone/status semantics as /active-fleet, so the dashboard's filter
    controls drive both without translation.
    """
    stmt = (
        select(
            Vehicle.id,
            Vehicle.license_plate,
            Vehicle.name,
            Vehicle.vehicle_class,
            Vehicle.cargo_capacity_tons,
            Vehicle.target_district,
            Vehicle.depot_origin,
            Vehicle.organization,
            Vehicle.status,
            Vehicle.last_ping,
            ST_Y(Vehicle.current_location).label("lat"),
            ST_X(Vehicle.current_location).label("lng"),
            VehicleTrip.trip_id,
            VehicleTrip.origin_name,
            VehicleTrip.dest_name,
            VehicleTrip.commodity_type,
            VehicleTrip.priority_level,
            VehicleTrip.status.label("trip_status"),
            VehicleTrip.estimated_arrival,
            VehicleTrip.last_rerouted_at,
        )
        .join(VehicleTrip, VehicleTrip.vehicle_id == Vehicle.id)
        .where(Vehicle.status == VehicleStatus.active)
        .order_by(VehicleTrip.last_rerouted_at.desc().nullslast())
    )

    if status == "deployed" or status is None:
        stmt = stmt.where(
            VehicleTrip.status.in_([TripStatus.IN_TRANSIT, TripStatus.REROUTED])
        )
    else:
        stmt = stmt.where(VehicleTrip.status == status.upper())

    rows = [r for r in (await db.execute(stmt)).all() if _zone_matches(zone, r.target_district)]

    if commodity and commodity not in ("All Commodities", "all"):
        rows = [r for r in rows if r.commodity_type and r.commodity_type.value == commodity]

    # One query for every trip's audit trail rather than one per vehicle.
    trip_ids = [r.trip_id for r in rows if r.trip_id]
    logs_by_trip: dict[str, list] = {}
    if trip_ids:
        for log in (
            await db.execute(
                select(RerouteLog)
                .where(RerouteLog.trip_id.in_(trip_ids))
                .order_by(RerouteLog.created_at.desc())
            )
        ).scalars().all():
            logs_by_trip.setdefault(str(log.trip_id), []).append(log)

    # Handover pairing, same rule as /active-fleet.
    pickups_by_district: dict[str, list[str]] = {}
    for r in rows:
        if r.vehicle_class in LAST_MILE_CLASSES and r.target_district:
            pickups_by_district.setdefault(r.target_district, []).append(
                r.license_plate or str(r.id)
            )
    cursor: dict[str, int] = {}

    vehicles: list[GovtTransitVehicle] = []
    total_reroutes = 0
    total_delay = 0

    for r in rows:
        logs = logs_by_trip.get(str(r.trip_id), [])
        transitions = [
            GovtTransitTransition(
                at=log.created_at,
                kind="REROUTED",
                detail=log.trigger_reason,
                delay_minutes=log.delay_variance_minutes,
                old_eta=log.old_eta,
                new_eta=log.new_eta,
            )
            for log in logs
        ]
        # Dispatch is the first transition every vehicle has, and without it a
        # trip with no reroutes would show an empty history rather than "on its
        # original route".
        transitions.append(
            GovtTransitTransition(
                at=r.last_rerouted_at or r.last_ping or datetime.now(timezone.utc),
                kind="DISPATCHED",
                detail=f"Dispatched {r.origin_name} to {r.dest_name}",
            )
        )

        delay = sum(log.delay_variance_minutes or 0 for log in logs)
        total_reroutes += len(logs)
        total_delay += delay

        linked = None
        if r.vehicle_class is VehicleClass.HEAVY_TRUCK:
            pool = pickups_by_district.get(r.target_district or "")
            if pool:
                d = r.target_district or ""
                idx = cursor.get(d, 0)
                cursor[d] = idx + 1
                linked = pool[idx % len(pool)]

        vehicles.append(
            GovtTransitVehicle(
                vid=r.license_plate or str(r.id),
                vehicle_id=str(r.id),
                trip_id=str(r.trip_id) if r.trip_id else None,
                vehicle_class=r.vehicle_class.value if r.vehicle_class else "UNCLASSIFIED",
                commodity=r.commodity_type.value if r.commodity_type else None,
                priority=r.priority_level.value if r.priority_level else None,
                origin=r.origin_name,
                destination=r.dest_name,
                target_district=r.target_district,
                depot_origin=r.depot_origin,
                cargo_capacity_tons=r.cargo_capacity_tons,
                organization=r.organization,
                status=r.trip_status.value if r.trip_status else r.status.value,
                current_coords=(
                    {"lat": round(r.lat, 5), "lng": round(r.lng, 5)}
                    if r.lat is not None and r.lng is not None
                    else None
                ),
                estimated_arrival=r.estimated_arrival,
                last_rerouted_at=r.last_rerouted_at,
                last_ping=r.last_ping,
                reroute_count=len(logs),
                total_delay_minutes=delay,
                local_pickup_linked=linked,
                transitions=transitions,
            )
        )

    return GovtTransitLogResponse(
        generated_at=datetime.now(timezone.utc),
        vehicle_count=len(vehicles),
        total_reroutes=total_reroutes,
        total_delay_minutes=total_delay,
        vehicles=vehicles,
    )
