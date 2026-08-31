"""SQLAlchemy ORM models with PostGIS geometry columns."""

import enum
import uuid
from datetime import datetime, timezone

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


# ── Enums ──────────────────────────────────────────────────────────────────────


class UserRole(str, enum.Enum):
    admin = "admin"
    field_official = "field_official"


class VehicleType(str, enum.Enum):
    truck = "truck"
    ambulance = "ambulance"
    utility = "utility"


class VehicleStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    maintenance = "maintenance"


class IncidentType(str, enum.Enum):
    flood = "flood"
    landslide = "landslide"
    road_damage = "road_damage"
    bridge_collapse = "bridge_collapse"


class IncidentStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"


class RiskLevel(str, enum.Enum):
    """Composite risk classification for Stage 2 hazard prediction."""
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


# ── Stage 1 Models ─────────────────────────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.field_official)
    auth_token = Column(String(256), nullable=True)
    district = Column(String(100), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    incidents = relationship("Incident", back_populates="reporter")


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False, default="Unnamed Vehicle")
    type = Column(Enum(VehicleType), nullable=False, default=VehicleType.truck)
    status = Column(Enum(VehicleStatus), nullable=False, default=VehicleStatus.active)
    current_location = Column(Geometry("POINT", srid=4326), nullable=True)
    last_ping = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    telemetry_records = relationship("Telemetry", back_populates="vehicle")


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type = Column(Enum(IncidentType), nullable=False)
    location = Column(Geometry("POINT", srid=4326), nullable=False)
    image_url = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    status = Column(
        Enum(IncidentStatus), nullable=False, default=IncidentStatus.open
    )
    reported_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    reporter = relationship("User", back_populates="incidents")


class Telemetry(Base):
    __tablename__ = "telemetry"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id = Column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
    location = Column(Geometry("POINT", srid=4326), nullable=False)
    speed = Column(Float, nullable=True)
    timestamp = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    vehicle = relationship("Vehicle", back_populates="telemetry_records")


# ── Stage 2 Models — AI Predictive Disruption Engine ───────────────────────────


class SpatialGridCell(Base):
    """H3-indexed hexagon grid cell with terrain features."""
    __tablename__ = "spatial_grid_cells"

    h3_index = Column(String(15), primary_key=True)
    geom = Column(Geometry("POLYGON", srid=4326), nullable=False)
    state = Column(String(50), nullable=False)
    district = Column(String(50), nullable=False)
    avg_slope_degrees = Column(Float, nullable=False, default=0.0)
    elevation_meters = Column(Float, nullable=False, default=0.0)
    landslide_susceptibility_base = Column(Float, default=0.0)  # 0.0 to 1.0

    # Relationships
    weather_records = relationship("WeatherTelemetryRecord", back_populates="grid_cell")
    risk_assessment = relationship(
        "SegmentRiskAssessment", back_populates="grid_cell", uselist=False
    )


class WeatherTelemetryRecord(Base):
    """Real-time environmental telemetry per H3 cell."""
    __tablename__ = "weather_telemetry"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    h3_index = Column(
        String(15), ForeignKey("spatial_grid_cells.h3_index"), nullable=False
    )
    timestamp = Column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    rainfall_1h_mm = Column(Float, nullable=False, default=0.0)
    rainfall_24h_mm = Column(Float, nullable=False, default=0.0)
    soil_saturation_pct = Column(Float, nullable=False, default=0.0)
    temperature_c = Column(Float, nullable=True)
    surface_runoff_rate = Column(Float, nullable=True)

    # Relationships
    grid_cell = relationship("SpatialGridCell", back_populates="weather_records")


class SegmentRiskAssessment(Base):
    """ML-computed predictive disruption scores per H3 cell."""
    __tablename__ = "segment_risk_assessments"

    h3_index = Column(
        String(15), ForeignKey("spatial_grid_cells.h3_index"), primary_key=True
    )
    last_evaluated = Column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    landslide_risk_score = Column(Float, nullable=False, default=0.0)  # 0.00–1.00
    flood_risk_score = Column(Float, nullable=False, default=0.0)      # 0.00–1.00
    composite_risk_level = Column(
        Enum(RiskLevel), nullable=False, default=RiskLevel.LOW
    )
    predicted_blockage_probability = Column(Float, nullable=False, default=0.0)
    primary_contributing_factor = Column(String(100), nullable=True)

    # Relationships
    grid_cell = relationship("SpatialGridCell", back_populates="risk_assessment")

