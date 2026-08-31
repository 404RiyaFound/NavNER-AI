"""Pydantic schemas for request validation and response serialization."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models import IncidentStatus, IncidentType, VehicleStatus, VehicleType


# ── Telemetry ──────────────────────────────────────────────────────────────────


class TelemetryCreate(BaseModel):
    vehicle_id: uuid.UUID
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    speed: float | None = Field(None, ge=0)


class TelemetryResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    lat: float
    lng: float
    speed: float | None
    timestamp: datetime

    class Config:
        from_attributes = True


# ── Incident ───────────────────────────────────────────────────────────────────


class IncidentCreate(BaseModel):
    """Used when the incident fields arrive as JSON (non-multipart)."""
    type: IncidentType
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    description: str | None = None
    reported_by: uuid.UUID | None = None


class IncidentResponse(BaseModel):
    id: uuid.UUID
    type: IncidentType
    lat: float
    lng: float
    image_url: str | None
    description: str | None
    status: IncidentStatus
    reported_by: uuid.UUID | None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Vehicle ────────────────────────────────────────────────────────────────────


class VehicleResponse(BaseModel):
    id: uuid.UUID
    name: str
    type: VehicleType
    status: VehicleStatus
    lat: float | None
    lng: float | None
    last_ping: datetime | None

    class Config:
        from_attributes = True


# ── Map State ──────────────────────────────────────────────────────────────────


class MapStateResponse(BaseModel):
    vehicles: list[VehicleResponse]
    incidents: list[IncidentResponse]


# ── Stage 2 — Hazard Analytics ─────────────────────────────────────────────────


class HazardFeatureProperties(BaseModel):
    """Properties of a single hazard GeoJSON feature."""
    h3_index: str
    state: str
    district: str
    risk_level: str
    landslide_prob: float
    flood_prob: float
    composite_score: float
    predicted_blockage_probability: float
    primary_threat: str | None = None
    avg_slope_degrees: float | None = None
    elevation_meters: float | None = None
    rainfall_1h_mm: float | None = None
    rainfall_24h_mm: float | None = None
    soil_saturation_pct: float | None = None
    action_required: str | None = None


class HazardFeatureGeometry(BaseModel):
    """GeoJSON geometry object."""
    type: str = "Polygon"
    coordinates: list


class HazardFeature(BaseModel):
    """A single GeoJSON Feature for the hazard map."""
    type: str = "Feature"
    geometry: HazardFeatureGeometry
    properties: HazardFeatureProperties


class HazardMapResponse(BaseModel):
    """GeoJSON FeatureCollection for the hazard heatmap overlay."""
    type: str = "FeatureCollection"
    generated_at: datetime
    features: list[HazardFeature]


class EvaluateGridRequest(BaseModel):
    """Request body for batch risk inference."""
    h3_indices: list[str] | None = Field(
        None,
        description="Optional list of H3 cell IDs to evaluate. "
                    "If empty/null, evaluates all active corridor cells.",
    )


class EvaluateGridResponse(BaseModel):
    """Summary result of a batch risk evaluation."""
    evaluated_cells: int
    critical_count: int
    high_count: int
    moderate_count: int
    low_count: int
    timestamp: datetime

