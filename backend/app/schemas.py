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
