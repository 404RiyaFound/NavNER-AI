"""Stage 4 Dashboard API — Centralized multi-district analytics endpoints.

Implements the four Grafana-equivalent panels from the PRD:
1. Current Consignment State
2. Delay Prediction Matrix
3. Fleet Summary Board
4. Hazard & Reroute Audits (24h)
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.alert_dispatcher import alert_dispatcher
from app.database import get_db
from app.models import (
    AlertLog,
    AlertTier,
    CommodityType,
    Incident,
    RerouteLog,
    RiskLevel,
    SegmentRiskAssessment,
    SpatialGridCell,
    TripPriority,
    TripStatus,
    Vehicle,
    VehicleStatus,
    VehicleTrip,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


# ── Panel 1: Current Consignment State ────────────────────────────────────────


@router.get("/consignment-state")
async def get_consignment_state(db: AsyncSession = Depends(get_db)):
    """Real-time consignment status aggregated by origin state.

    Returns the number of consignments and running fleet by origin.
    Mirrors the Redshift MV `consignment_stream`.
    """
    # Group active trips by commodity type and priority
    stmt = (
        select(
            VehicleTrip.origin_name,
            func.count(VehicleTrip.trip_id).label("total_consignments"),
            func.count(distinct(VehicleTrip.vehicle_id)).label("running_fleet"),
            func.sum(case(
                (VehicleTrip.status == TripStatus.IN_TRANSIT, 1), else_=0
            )).label("in_transit"),
            func.sum(case(
                (VehicleTrip.status == TripStatus.REROUTED, 1), else_=0
            )).label("rerouted"),
            func.sum(case(
                (VehicleTrip.status == TripStatus.PENDING, 1), else_=0
            )).label("pending"),
            func.sum(case(
                (VehicleTrip.status == TripStatus.COMPLETED, 1), else_=0
            )).label("completed"),
        )
        .where(VehicleTrip.status.in_([
            TripStatus.IN_TRANSIT, TripStatus.REROUTED, TripStatus.PENDING
        ]))
        .group_by(VehicleTrip.origin_name)
    )
    rows = (await db.execute(stmt)).all()

    # Also get commodity breakdown
    commodity_stmt = (
        select(
            VehicleTrip.commodity_type,
            func.count(VehicleTrip.trip_id).label("count"),
        )
        .where(VehicleTrip.status.in_([
            TripStatus.IN_TRANSIT, TripStatus.REROUTED, TripStatus.PENDING
        ]))
        .group_by(VehicleTrip.commodity_type)
    )
    commodity_rows = (await db.execute(commodity_stmt)).all()

    origins = []
    for row in rows:
        origins.append({
            "origin": row.origin_name,
            "total_consignments": row.total_consignments,
            "running_fleet": row.running_fleet,
            "in_transit": row.in_transit or 0,
            "rerouted": row.rerouted or 0,
            "pending": row.pending or 0,
            "completed": row.completed or 0,
        })

    commodity_breakdown = {}
    for row in commodity_rows:
        ct = row.commodity_type
        if isinstance(ct, CommodityType):
            ct = ct.value
        commodity_breakdown[ct] = row.count

    return {
        "panel": "consignment_state",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "origins": origins,
        "commodity_breakdown": commodity_breakdown,
        "total_active_consignments": sum(o["total_consignments"] for o in origins),
        "total_running_fleet": sum(o["running_fleet"] for o in origins),
    }


# ── Panel 2: Delay Prediction Matrix ─────────────────────────────────────────


@router.get("/delay-prediction")
async def get_delay_prediction(db: AsyncSession = Depends(get_db)):
    """Delay prediction matrix using Stage 2 ML risk scores.

    Uses composite risk assessments to estimate delay probability for
    each active trip. Flags trips > 75% as CRITICAL_RISK.
    Mirrors the Redshift ML query from 03_delay_prediction.sql.
    """
    now = datetime.now(timezone.utc)

    # Get active trips with their vehicle info
    stmt = (
        select(VehicleTrip, Vehicle.name.label("vehicle_name"))
        .join(Vehicle, Vehicle.id == VehicleTrip.vehicle_id)
        .where(VehicleTrip.status.in_([
            TripStatus.IN_TRANSIT, TripStatus.REROUTED, TripStatus.PENDING
        ]))
    )
    trip_rows = (await db.execute(stmt)).all()

    # Get risk assessments for computing delay probability
    risk_stmt = select(SegmentRiskAssessment)
    risks = (await db.execute(risk_stmt)).scalars().all()

    # Build district → max risk score map
    district_risk: dict[str, float] = {}
    for risk in risks:
        cell = await db.get(SpatialGridCell, risk.h3_index)
        if cell:
            current = district_risk.get(cell.district, 0.0)
            composite = max(risk.landslide_risk_score, risk.flood_risk_score)
            district_risk[cell.district] = max(current, composite)

    predictions = []
    for row in trip_rows:
        trip = row[0] if hasattr(row, '__getitem__') else row.VehicleTrip
        vehicle_name = row.vehicle_name if hasattr(row, 'vehicle_name') else "Unknown"

        # Compute delay probability based on:
        # - Trip priority (emergency = higher weight)
        # - Current status (rerouted = already delayed)
        # - Regional risk scores
        # - ETA proximity

        base_delay_prob = 0.0

        # Factor 1: Current trip status
        if trip.status == TripStatus.REROUTED:
            base_delay_prob += 0.35
        elif trip.status == TripStatus.PENDING:
            base_delay_prob += 0.10

        # Factor 2: Commodity urgency
        commodity_weight = {
            CommodityType.MEDICINE: 0.15,
            CommodityType.FUEL: 0.10,
            CommodityType.FOOD_GRAINS: 0.08,
            CommodityType.GENERAL: 0.05,
        }
        base_delay_prob += commodity_weight.get(trip.commodity_type, 0.05)

        # Factor 3: Route hazard (max risk from any district)
        max_risk = max(district_risk.values()) if district_risk else 0.0
        base_delay_prob += max_risk * 0.40

        # Factor 4: ETA check
        if trip.estimated_arrival and trip.estimated_arrival < now:
            base_delay_prob += 0.20  # Already past ETA

        # Clamp to [0, 1]
        delay_probability = min(max(base_delay_prob, 0.0), 1.0)

        # Classify risk
        if delay_probability > 0.75:
            risk_class = "CRITICAL_RISK"
        elif delay_probability > 0.50:
            risk_class = "HIGH_RISK"
        elif delay_probability > 0.25:
            risk_class = "MODERATE_RISK"
        else:
            risk_class = "LOW_RISK"

        commodity = trip.commodity_type.value if trip.commodity_type else "GENERAL"
        priority = trip.priority_level.value if trip.priority_level else "STANDARD"
        status = trip.status.value if trip.status else "IN_TRANSIT"

        predictions.append({
            "trip_id": str(trip.trip_id),
            "vehicle_name": vehicle_name,
            "origin": trip.origin_name,
            "destination": trip.dest_name,
            "commodity_type": commodity,
            "priority_level": priority,
            "status": status,
            "delay_probability": round(delay_probability, 3),
            "risk_classification": risk_class,
            "estimated_arrival": trip.estimated_arrival.isoformat() if trip.estimated_arrival else None,
        })

    # Sort by delay probability descending
    predictions.sort(key=lambda x: x["delay_probability"], reverse=True)

    critical_count = sum(1 for p in predictions if p["risk_classification"] == "CRITICAL_RISK")
    high_count = sum(1 for p in predictions if p["risk_classification"] == "HIGH_RISK")

    return {
        "panel": "delay_prediction",
        "generated_at": now.isoformat(),
        "predictions": predictions,
        "summary": {
            "total_trips": len(predictions),
            "critical_risk": critical_count,
            "high_risk": high_count,
            "avg_delay_probability": round(
                sum(p["delay_probability"] for p in predictions) / max(len(predictions), 1), 3
            ),
        },
    }


# ── Panel 3: Fleet Summary Board ─────────────────────────────────────────────


@router.get("/fleet-summary")
async def get_fleet_summary(db: AsyncSession = Depends(get_db)):
    """Aggregated fleet metrics grouped by state/district.

    Mirrors the Redshift MV `fleet_summary_board`.
    """
    # Vehicle status breakdown
    vehicle_stmt = (
        select(
            Vehicle.type,
            Vehicle.status,
            func.count(Vehicle.id).label("count"),
        )
        .group_by(Vehicle.type, Vehicle.status)
    )
    vehicle_rows = (await db.execute(vehicle_stmt)).all()

    # Trip metrics by commodity type
    trip_stmt = (
        select(
            VehicleTrip.commodity_type,
            func.count(VehicleTrip.trip_id).label("count"),
        )
        .where(VehicleTrip.status.in_([
            TripStatus.IN_TRANSIT, TripStatus.REROUTED, TripStatus.PENDING
        ]))
        .group_by(VehicleTrip.commodity_type)
    )
    trip_rows = (await db.execute(trip_stmt)).all()

    # Build vehicle type breakdown
    fleet_by_type = {}
    for row in vehicle_rows:
        vtype = row.type.value if hasattr(row.type, 'value') else str(row.type)
        vstatus = row.status.value if hasattr(row.status, 'value') else str(row.status)
        if vtype not in fleet_by_type:
            fleet_by_type[vtype] = {"active": 0, "inactive": 0, "maintenance": 0, "total": 0}
        fleet_by_type[vtype][vstatus] = row.count
        fleet_by_type[vtype]["total"] += row.count

    # Build commodity trip breakdown
    commodity_trips = {}
    for row in trip_rows:
        ct = row.commodity_type.value if hasattr(row.commodity_type, 'value') else str(row.commodity_type)
        commodity_trips[ct] = row.count

    # Total counts
    total_vehicles = sum(ft["total"] for ft in fleet_by_type.values())
    total_active = sum(ft.get("active", 0) for ft in fleet_by_type.values())
    total_maintenance = sum(ft.get("maintenance", 0) for ft in fleet_by_type.values())

    return {
        "panel": "fleet_summary",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "fleet_by_type": fleet_by_type,
        "commodity_trips": commodity_trips,
        "totals": {
            "total_vehicles": total_vehicles,
            "active": total_active,
            "maintenance": total_maintenance,
            "inactive": total_vehicles - total_active - total_maintenance,
        },
    }


# ── Panel 4: Reroute Audit (24h) ─────────────────────────────────────────────


@router.get("/reroute-audit")
async def get_reroute_audit(
    hours: int = Query(24, ge=1, le=168, description="Lookback window in hours"),
    db: AsyncSession = Depends(get_db),
):
    """Reroute audit trail for the last N hours.

    Mirrors the Redshift MV `reroute_audit_24h`.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Get reroute logs with trip info
    stmt = (
        select(
            RerouteLog,
            VehicleTrip.origin_name,
            VehicleTrip.dest_name,
            VehicleTrip.commodity_type,
            VehicleTrip.priority_level,
            Vehicle.name.label("vehicle_name"),
        )
        .join(VehicleTrip, VehicleTrip.trip_id == RerouteLog.trip_id)
        .join(Vehicle, Vehicle.id == VehicleTrip.vehicle_id)
        .where(RerouteLog.created_at >= cutoff)
        .order_by(RerouteLog.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()

    events = []
    total_delay = 0

    for row in rows:
        log = row[0]
        delay = log.delay_variance_minutes or 0
        total_delay += abs(delay)

        commodity = row.commodity_type.value if hasattr(row.commodity_type, 'value') else str(row.commodity_type)
        priority = row.priority_level.value if hasattr(row.priority_level, 'value') else str(row.priority_level)

        events.append({
            "log_id": log.log_id,
            "trip_id": str(log.trip_id),
            "vehicle_name": row.vehicle_name,
            "origin": row.origin_name,
            "destination": row.dest_name,
            "commodity_type": commodity,
            "priority_level": priority,
            "trigger_reason": log.trigger_reason,
            "delay_minutes": delay,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "old_eta": log.old_eta.isoformat() if log.old_eta else None,
            "new_eta": log.new_eta.isoformat() if log.new_eta else None,
        })

    # Aggregate by trigger reason
    reason_counts: dict[str, int] = {}
    for evt in events:
        reason = evt["trigger_reason"]
        reason_counts[reason] = reason_counts.get(reason, 0) + 1

    return {
        "panel": "reroute_audit",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "lookback_hours": hours,
        "events": events,
        "summary": {
            "total_reroutes": len(events),
            "total_delay_minutes": total_delay,
            "avg_delay_minutes": round(total_delay / max(len(events), 1), 1),
            "by_reason": reason_counts,
        },
    }


# ── Alert Log Endpoint ────────────────────────────────────────────────────────


@router.get("/alert-log")
async def get_alert_log(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Recent alert dispatch log from the in-memory dispatcher."""
    alerts = alert_dispatcher.get_recent_alerts(limit)
    return {
        "alerts": alerts,
        "buffered_informational": alert_dispatcher.get_buffered_count(),
        "total_returned": len(alerts),
    }
