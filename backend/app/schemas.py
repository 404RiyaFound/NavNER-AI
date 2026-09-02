"""Pydantic schemas for request validation and response serialization."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models import IncidentStatus, IncidentType, VehicleStatus, VehicleType, VehicleClass


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
    license_plate: str | None
    organization: str | None
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
    license_plate: str | None
    organization: str | None
    origin_name: str
    dest_name: str
    # Explicit coordinates for OSRM-based frontend routing
    origin_lat: float | None = None
    origin_lng: float | None = None
    dest_lat: float | None = None
    dest_lng: float | None = None
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


# ── Government Fleet Manager (issue #65) ──────────────────────────────────────


class GovtFleetRegisterRequest(BaseModel):
    """Provisioning form submitted by a government dispatcher (§3.1)."""

    license_plate: str = Field(..., min_length=4, max_length=20)
    vehicle_class: VehicleClass
    cargo_capacity_tons: float = Field(..., gt=0, le=100)
    depot_origin: str = Field(..., min_length=2, max_length=120)
    target_district: str = Field(..., min_length=2, max_length=120)
    organization: str | None = Field(None, max_length=100)
    name: str | None = Field(None, max_length=120)


class GovtFleetVehicle(BaseModel):
    """One vehicle as the NavNER dashboard consumes it."""

    vid: str
    type: str
    commodity: str | None = None
    origin: str | None = None
    destination: str | None = None
    current_coords: dict[str, float] | None = None
    status: str
    local_pickup_linked: str | None = None
    cargo_capacity_tons: float | None = None
    target_district: str | None = None


class GovtActiveFleetResponse(BaseModel):
    """Payload for GET /api/v1/govt/active-fleet (§3.3)."""

    fleet_count: int
    timestamp: datetime
    vehicles: list[GovtFleetVehicle]


class GovtKpiBlock(BaseModel):
    """One of the five VAHAN-style KPI blocks, with its breakdown table."""

    key: str
    label: str
    value: int
    # Rows render as the dense table beneath each block. `delta_pct` is None
    # where there is no prior period to compare against, rather than 0 — the
    # dashboard must not draw a 0% arrow for "unknown".
    rows: list[dict[str, object]]


class GovtDashboardSummary(BaseModel):
    """Everything the fleet-manager landing page needs in one call."""

    generated_at: datetime
    blocks: list[GovtKpiBlock]
    deployment_by_district: list[dict[str, object]]
    commodities_in_transit: list[dict[str, object]]


class GovtTransitTransition(BaseModel):
    """One state change in a vehicle's journey."""

    at: datetime
    kind: str            # DISPATCHED | REROUTED | ETA_REVISED
    detail: str
    delay_minutes: int | None = None
    old_eta: datetime | None = None
    new_eta: datetime | None = None


class GovtTransitVehicle(BaseModel):
    """Full transit record for one vehicle, including its transition history."""

    vid: str
    vehicle_id: str
    trip_id: str | None = None
    vehicle_class: str
    commodity: str | None = None
    priority: str | None = None
    origin: str | None = None
    destination: str | None = None
    target_district: str | None = None
    depot_origin: str | None = None
    cargo_capacity_tons: float | None = None
    organization: str | None = None
    status: str
    current_coords: dict[str, float] | None = None
    estimated_arrival: datetime | None = None
    last_rerouted_at: datetime | None = None
    last_ping: datetime | None = None
    reroute_count: int = 0
    total_delay_minutes: int = 0
    local_pickup_linked: str | None = None
    transitions: list[GovtTransitTransition] = []


class GovtTransitLogResponse(BaseModel):
    """Payload for GET /api/v1/govt/transit-log."""

    generated_at: datetime
    vehicle_count: int
    total_reroutes: int
    total_delay_minutes: int
    vehicles: list[GovtTransitVehicle]
