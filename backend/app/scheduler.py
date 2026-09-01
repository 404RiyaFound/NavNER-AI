"""APScheduler-based background task for periodic risk evaluation.

Runs every 30 minutes: fetches latest weather for all H3 cells → runs ML
batch inference → updates segment_risk_assessments → broadcasts WebSocket
alert to all connected dashboard clients.

Stage 4: Also triggers CRITICAL alert dispatch for critical risk cells
and runs a batched informational alert summary every 60 minutes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select, update

from app.alert_dispatcher import alert_dispatcher
from app.database import async_session
from app.models import (
    RiskLevel,
    SegmentRiskAssessment,
    SpatialGridCell,
)
from app.risk_engine import risk_engine
from app.weather_service import fetch_weather_for_grid
from app.websocket import manager

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def run_risk_evaluation() -> dict:
    """Evaluate all spatial grid cells and update risk assessments.

    Returns a summary dict with counts per risk level.
    """
    now = datetime.now(timezone.utc)
    counts = {"LOW": 0, "MODERATE": 0, "HIGH": 0, "CRITICAL": 0}
    evaluated = 0
    critical_indices = []

    async with async_session() as db:
        # Fetch all grid cells
        cells = (await db.execute(select(SpatialGridCell))).scalars().all()

        if not cells:
            logger.info("[Scheduler] No grid cells found — skipping evaluation.")
            return {"evaluated_cells": 0, **counts}

        # Resolve every cell centroid up front, then fetch all weather in one
        # concurrent, grid-deduplicated pass. This previously ran one sequential
        # await per cell (~0.7 s each), which exhausted the 30-minute scheduling
        # interval at roughly 2,500 cells and blocked any grid expansion.
        import h3

        centroids = [h3.cell_to_latlng(cell.h3_index) for cell in cells]
        fetch_started = datetime.now(timezone.utc)
        weather_by_cell = await fetch_weather_for_grid(centroids)
        fetch_seconds = (datetime.now(timezone.utc) - fetch_started).total_seconds()
        logger.info(
            "[Scheduler] Weather fetched for %d cells in %.1fs.", len(cells), fetch_seconds
        )

        for cell, (lat, lng), weather in zip(cells, centroids, weather_by_cell):
            if weather is None:
                continue

            try:
                # Build terrain data from cell attributes
                terrain = {
                    "avg_slope_degrees": cell.avg_slope_degrees,
                    "elevation_meters": cell.elevation_meters,
                    "landslide_susceptibility_base": cell.landslide_susceptibility_base or 0.0,
                }

                # Run ML inference
                result = risk_engine.evaluate_cell(weather, terrain)

                risk_level = RiskLevel(result["composite_risk_level"])

                # Upsert risk assessment
                existing = await db.get(SegmentRiskAssessment, cell.h3_index)
                if existing:
                    existing.last_evaluated = now
                    existing.landslide_risk_score = result["landslide_risk_score"]
                    existing.flood_risk_score = result["flood_risk_score"]
                    existing.composite_risk_level = risk_level
                    existing.predicted_blockage_probability = result["predicted_blockage_probability"]
                    existing.primary_contributing_factor = result["primary_contributing_factor"]
                else:
                    db.add(SegmentRiskAssessment(
                        h3_index=cell.h3_index,
                        last_evaluated=now,
                        landslide_risk_score=result["landslide_risk_score"],
                        flood_risk_score=result["flood_risk_score"],
                        composite_risk_level=risk_level,
                        predicted_blockage_probability=result["predicted_blockage_probability"],
                        primary_contributing_factor=result["primary_contributing_factor"],
                    ))

                if risk_level in (RiskLevel.CRITICAL, RiskLevel.HIGH):
                    critical_indices.append(cell.h3_index)

                counts[result["composite_risk_level"]] += 1
                evaluated += 1

                # ── Stage 4: Auto-trigger CRITICAL alerts ──────────────────
                if result["composite_risk_level"] == "CRITICAL":
                    await alert_dispatcher.process_event({
                        "event_type": "HIGH_PROBABILITY_LANDSLIDE" if result["landslide_risk_score"] > result["flood_risk_score"] else "IMMEDIATE_REROUTE",
                        "severity": "CRITICAL",
                        "message": f"CRITICAL risk in {cell.district}, {cell.state}: "
                                   f"{result['primary_contributing_factor']} "
                                   f"(blockage prob: {result['predicted_blockage_probability']:.0%})",
                        "source": "risk_evaluation_scheduler",
                        "location": {"lat": lat, "lng": lng, "district": cell.district},
                    })
                elif result["composite_risk_level"] == "HIGH":
                    await alert_dispatcher.process_event({
                        "event_type": "SPEED_RESTRICTION",
                        "severity": "HIGH",
                        "message": f"HIGH risk in {cell.district}, {cell.state}: "
                                   f"{result['primary_contributing_factor']}",
                        "source": "risk_evaluation_scheduler",
                        "location": {"lat": lat, "lng": lng, "district": cell.district},
                    })

            except Exception as exc:
                logger.error(
                    "[Scheduler] Error evaluating cell %s: %s", cell.h3_index, exc
                )

        await db.commit()

        if critical_indices:
            from app.services.reroute_trigger import trigger_hazard_reroute
            await trigger_hazard_reroute(critical_indices, db)

    summary = {
        "evaluated_cells": evaluated,
        "critical_count": counts["CRITICAL"],
        "high_count": counts["HIGH"],
        "moderate_count": counts["MODERATE"],
        "low_count": counts["LOW"],
        "timestamp": now.isoformat(),
    }

    total_seconds = (datetime.now(timezone.utc) - now).total_seconds()
    if total_seconds > 30 * 60:
        logger.warning(
            "[Scheduler] Risk evaluation took %.0fs, exceeding its 30-minute interval "
            "(%d cells). Runs will be skipped — reduce grid size or raise the interval.",
            total_seconds, evaluated,
        )

    # Broadcast risk update to all connected clients
    await manager.broadcast({
        "event": "risk_update",
        "data": summary,
    })

    logger.info(
        "[Scheduler] Risk evaluation complete — %d cells evaluated "
        "(CRITICAL=%d, HIGH=%d, MODERATE=%d, LOW=%d)",
        evaluated, counts["CRITICAL"], counts["HIGH"],
        counts["MODERATE"], counts["LOW"],
    )

    return summary


async def dispatch_batched_alerts() -> dict:
    """Dispatch batched informational alerts as an hourly summary.

    Stage 4: Collects all buffered INFORMATIONAL events and sends
    them as a single digest via SNS (or logs in dev mode).
    """
    result = await alert_dispatcher.dispatch_batched_summary()
    logger.info(
        "[Scheduler] Batched alert dispatch — %d events, dispatched=%s",
        result.get("count", 0), result.get("dispatched", False),
    )
    return result


def start_scheduler() -> None:
    """Start the APScheduler with periodic jobs."""
    # Risk evaluation every 30 minutes.
    # max_instances=1 + coalesce prevent a slow run from overlapping the next one
    # and racing on segment_risk_assessments; misfire_grace_time lets a late run
    # still fire rather than being dropped silently.
    scheduler.add_job(
        run_risk_evaluation,
        "interval",
        minutes=30,
        id="risk_evaluation",
        name="Periodic risk evaluation",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )

    # Stage 4: Batched alert dispatch every 60 minutes
    scheduler.add_job(
        dispatch_batched_alerts,
        "interval",
        minutes=60,
        id="batched_alert_dispatch",
        name="Batched informational alert dispatch",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("[Scheduler] Started — risk evaluation every 30m, alert dispatch every 60m.")


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[Scheduler] Stopped.")

