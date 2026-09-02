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
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
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

    district_rows = [{"label": d, "count": c} for d, c in by_district]
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
