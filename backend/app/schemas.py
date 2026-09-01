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


# ── Stage 3 — Dynamic Routing & Fleet Optimization ────────────────────────────


class RouteCalculateRequest(BaseModel):
    """Request payload for route calculation / recalculation."""
    trip_id: uuid.UUID
    avoid_hazards: bool = True
    max_hazard_tolerance: float = Field(0.60, ge=0.0, le=1.0)


class TurnByTurnStep(BaseModel):
    """A single step in turn-by-turn navigation instructions."""
    step: int
    instruction: str
    distance_km: float


class RouteGeoJSON(BaseModel):
    """GeoJSON LineString for a computed route."""
    type: str = "LineString"
    coordinates: list[list[float]]


class RouteCalculateResponse(BaseModel):
    """Response from the route calculation endpoint."""
    status: str  # 'REROUTED_SUCCESSFULLY', 'ROUTE_CALCULATED', 'NO_ROUTE_FOUND'
    total_distance_km: float
    estimated_duration_min: float
    previous_duration_min: float | None = None
    delay_minutes: float | None = None
    avoided_hazards_count: int = 0
    route_geojson: RouteGeoJSON
    turn_by_turn_instructions: list[TurnByTurnStep]


class FleetTripResponse(BaseModel):
    """Single trip in the fleet status feed."""
    trip_id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_name: str
    origin_name: str
    dest_name: str
    commodity_type: str
    priority_level: str
    status: str
    estimated_arrival: datetime | None = None
    last_rerouted_at: datetime | None = None
    delay_minutes: int | None = None
    original_route: RouteGeoJSON | None = None
    current_route: RouteGeoJSON | None = None

    class Config:
        from_attributes = True


class FleetStatusResponse(BaseModel):
    """Full fleet status feed for the command center."""
    active_trips: list[FleetTripResponse]
    total_active: int
    rerouted_count: int
    emergency_count: int


