"""Stage 2 Analytics API — Hazard map and batch risk evaluation endpoints."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import h3
from fastapi import APIRouter, Depends, Query
from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    RiskLevel,
    SegmentRiskAssessment,
    SpatialGridCell,
    WeatherTelemetryRecord,
)
from app.risk_engine import risk_engine
from app.schemas import (
    EvaluateGridRequest,
    EvaluateGridResponse,
    HazardFeature,
    HazardFeatureGeometry,
    HazardFeatureProperties,
    HazardMapResponse,
)
from app.weather_service import fetch_weather_for_point
from app.websocket import manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


# ── Endpoint 1: Hazard Heatmap GeoJSON ─────────────────────────────────────────


@router.get("/hazard-map", response_model=HazardMapResponse)
async def get_hazard_map(
    district: str | None = Query(None, description="Filter by district name"),
    min_risk: float = Query(0.0, ge=0.0, le=1.0, description="Minimum composite risk score"),
    db: AsyncSession = Depends(get_db),
):
    """Return a GeoJSON FeatureCollection of H3 hazard polygons with risk scores.

    Joins spatial_grid_cells with segment_risk_assessments.  Optionally filter
    by district and minimum composite risk score.
    """
    stmt = (
        select(
            SpatialGridCell.h3_index,
            SpatialGridCell.state,
            SpatialGridCell.district,
            SpatialGridCell.avg_slope_degrees,
            SpatialGridCell.elevation_meters,
            ST_AsGeoJSON(SpatialGridCell.geom).label("geojson"),
            SegmentRiskAssessment.landslide_risk_score,
            SegmentRiskAssessment.flood_risk_score,
            SegmentRiskAssessment.composite_risk_level,
            SegmentRiskAssessment.predicted_blockage_probability,
            SegmentRiskAssessment.primary_contributing_factor,
        )
        .join(
            SegmentRiskAssessment,
            SegmentRiskAssessment.h3_index == SpatialGridCell.h3_index,
        )
    )

    if district:
        stmt = stmt.where(SpatialGridCell.district == district)

    rows = (await db.execute(stmt)).all()

    features: list[HazardFeature] = []

    for row in rows:
        # Compute composite score from individual risk scores
        ls = row.landslide_risk_score or 0.0
        fl = row.flood_risk_score or 0.0
        composite = max(ls, fl) * 0.8 + min(ls, fl) * 0.2

        # Apply min_risk filter
        if composite < min_risk:
            continue

        risk_level = row.composite_risk_level
        if isinstance(risk_level, RiskLevel):
            risk_level = risk_level.value

        # Action mapping
        action_map = {
            "LOW": "NORMAL_TRANSIT",
            "MODERATE": "SPEED_RESTRICTION",
            "HIGH": "REROUTE_RECOMMENDED",
            "CRITICAL": "IMMEDIATE_REROUTE",
        }

        # Fetch latest weather telemetry for enrichment (if available)
        latest_weather = (
            await db.execute(
                select(WeatherTelemetryRecord)
                .where(WeatherTelemetryRecord.h3_index == row.h3_index)
                .order_by(WeatherTelemetryRecord.timestamp.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        # Parse the PostGIS GeoJSON
        geom_dict = json.loads(row.geojson)

        feature = HazardFeature(
            geometry=HazardFeatureGeometry(
                type=geom_dict.get("type", "Polygon"),
                coordinates=geom_dict.get("coordinates", []),
            ),
            properties=HazardFeatureProperties(
                h3_index=row.h3_index,
                state=row.state,
                district=row.district,
                risk_level=risk_level,
                landslide_prob=round(ls, 4),
                flood_prob=round(fl, 4),
                composite_score=round(composite, 4),
                predicted_blockage_probability=round(
                    row.predicted_blockage_probability or 0.0, 4
                ),
                primary_threat=row.primary_contributing_factor,
                avg_slope_degrees=row.avg_slope_degrees,
                elevation_meters=row.elevation_meters,
                rainfall_1h_mm=latest_weather.rainfall_1h_mm if latest_weather else None,
                rainfall_24h_mm=latest_weather.rainfall_24h_mm if latest_weather else None,
                soil_saturation_pct=latest_weather.soil_saturation_pct if latest_weather else None,
                action_required=action_map.get(risk_level, "NORMAL_TRANSIT"),
            ),
        )
        features.append(feature)

    return HazardMapResponse(
        generated_at=datetime.now(timezone.utc),
        features=features,
    )


# ── Endpoint 2: Trigger Batch Risk Evaluation ─────────────────────────────────


@router.post("/evaluate-grid", response_model=EvaluateGridResponse)
async def evaluate_grid(
    payload: EvaluateGridRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Trigger batch ML risk inference for grid cells.

    If h3_indices is provided, evaluates only those cells.  Otherwise evaluates
    all cells in spatial_grid_cells.

    Process: fetch weather → build feature vectors → ML inference → update DB →
    broadcast WebSocket alert.
    """
    now = datetime.now(timezone.utc)
    counts = {"LOW": 0, "MODERATE": 0, "HIGH": 0, "CRITICAL": 0}
    evaluated = 0

    # Determine which cells to evaluate
    stmt = select(SpatialGridCell)
    if payload and payload.h3_indices:
        stmt = stmt.where(SpatialGridCell.h3_index.in_(payload.h3_indices))

    cells = (await db.execute(stmt)).scalars().all()

    for cell in cells:
        try:
            # Get centroid from H3 index
            lat, lng = h3.cell_to_latlng(cell.h3_index)

            # Fetch real weather
            weather = await fetch_weather_for_point(lat, lng)

            # Store weather telemetry record
            weather_record = WeatherTelemetryRecord(
                h3_index=cell.h3_index,
                timestamp=now,
                rainfall_1h_mm=weather["rainfall_1h_mm"],
                rainfall_24h_mm=weather["rainfall_24h_mm"],
                soil_saturation_pct=weather["soil_saturation_pct"],
                temperature_c=weather["temperature_c"],
                surface_runoff_rate=weather["surface_runoff_rate"],
            )
            db.add(weather_record)

            # Build terrain dict
            terrain = {
                "avg_slope_degrees": cell.avg_slope_degrees,
                "elevation_meters": cell.elevation_meters,
                "landslide_susceptibility_base": cell.landslide_susceptibility_base or 0.0,
            }

            # ML inference
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
            logger.error("Error evaluating cell %s: %s", cell.h3_index, exc)

    await db.commit()

    # Broadcast update to dashboard clients
    await manager.broadcast({
        "event": "risk_update",
        "data": {
            "evaluated_cells": evaluated,
            "critical_count": counts["CRITICAL"],
            "high_count": counts["HIGH"],
            "moderate_count": counts["MODERATE"],
            "low_count": counts["LOW"],
            "timestamp": now.isoformat(),
        },
    })

    return EvaluateGridResponse(
        evaluated_cells=evaluated,
        critical_count=counts["CRITICAL"],
        high_count=counts["HIGH"],
        moderate_count=counts["MODERATE"],
        low_count=counts["LOW"],
        timestamp=now,
    )
