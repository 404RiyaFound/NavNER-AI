"""APScheduler-based background task for periodic risk evaluation.

Runs every 30 minutes: fetches latest weather for all H3 cells → runs ML
batch inference → updates segment_risk_assessments → broadcasts WebSocket
alert to all connected dashboard clients.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select, update

from app.database import async_session
from app.models import (
    RiskLevel,
    SegmentRiskAssessment,
    SpatialGridCell,
)
from app.risk_engine import risk_engine
from app.weather_service import fetch_weather_for_point
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

    async with async_session() as db:
        # Fetch all grid cells
        cells = (await db.execute(select(SpatialGridCell))).scalars().all()

        if not cells:
            logger.info("[Scheduler] No grid cells found — skipping evaluation.")
            return {"evaluated_cells": 0, **counts}

        for cell in cells:
            try:
                # Get centroid coordinates from H3 index
                import h3
                lat, lng = h3.cell_to_latlng(cell.h3_index)

                # Fetch real weather data
                weather = await fetch_weather_for_point(lat, lng)

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

                counts[result["composite_risk_level"]] += 1
                evaluated += 1

            except Exception as exc:
                logger.error(
                    "[Scheduler] Error evaluating cell %s: %s", cell.h3_index, exc
                )

        await db.commit()

    summary = {
        "evaluated_cells": evaluated,
        "critical_count": counts["CRITICAL"],
        "high_count": counts["HIGH"],
        "moderate_count": counts["MODERATE"],
        "low_count": counts["LOW"],
        "timestamp": now.isoformat(),
    }

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


def start_scheduler() -> None:
    """Start the APScheduler with a 30-minute interval job."""
    scheduler.add_job(
        run_risk_evaluation,
        "interval",
        minutes=30,
        id="risk_evaluation",
        name="Periodic risk evaluation",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("[Scheduler] Started — risk evaluation every 30 minutes.")


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[Scheduler] Stopped.")
