"""SQLAlchemy ORM models with PostGIS geometry columns."""

import enum
import uuid
from datetime import datetime, timezone

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
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


# ── Stage 3 Enums ─────────────────────────────────────────────────────────────


class RoadStatus(str, enum.Enum):
    """Current traversability status of a road segment."""
    CLEAR = "CLEAR"
    RESTRICTED = "RESTRICTED"
    BLOCKED = "BLOCKED"


class CommodityType(str, enum.Enum):
    """Type of cargo being transported."""
    MEDICINE = "MEDICINE"
    FOOD_GRAINS = "FOOD_GRAINS"
    FUEL = "FUEL"
    GENERAL = "GENERAL"


class TripPriority(str, enum.Enum):
    """Priority level for a supply vehicle trip."""
    EMERGENCY = "EMERGENCY"
    HIGH_PRIORITY = "HIGH_PRIORITY"
    STANDARD = "STANDARD"


class TripStatus(str, enum.Enum):
    """Current status of a vehicle trip."""
    PENDING = "PENDING"
    IN_TRANSIT = "IN_TRANSIT"
    REROUTED = "REROUTED"
    COMPLETED = "COMPLETED"


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


class VehicleClass(str, enum.Enum):
    """Government provisioning classes (issue #65 §3.1).

    Distinct from VehicleType, which describes the chassis the dashboard draws.
    This is the procurement capability class a fleet manager registers against.
    """

    HEAVY_TRUCK = "HEAVY_TRUCK"
    PICKUP_4X4 = "PICKUP_4X4"
    AMBULANCE = "AMBULANCE"
    NDRF_BOAT = "NDRF_BOAT"
    UTILITY = "UTILITY"


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False, default="Unnamed Vehicle")
    type = Column(Enum(VehicleType), nullable=False, default=VehicleType.truck)
    status = Column(Enum(VehicleStatus), nullable=False, default=VehicleStatus.active)
    license_plate = Column(String(20), nullable=True)
    organization = Column(String(100), nullable=True)
    current_location = Column(Geometry("POINT", srid=4326), nullable=True)
    last_ping = Column(DateTime(timezone=True), nullable=True)

    # ── Government provisioning fields (issue #65 §3.1) ───────────────────
    # All nullable: vehicles seeded or ingested outside the fleet-manager
    # portal have no provisioning record, and the dashboard must not require
    # one to render them.
    vehicle_class = Column(Enum(VehicleClass), nullable=True)
    cargo_capacity_tons = Column(Float, nullable=True)
    depot_origin = Column(String(120), nullable=True)
    target_district = Column(String(120), nullable=True)

    # Relationships
    telemetry_records = relationship("Telemetry", back_populates="vehicle")
    trips = relationship("VehicleTrip", back_populates="vehicle")


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


# ── Stage 3 Models — Dynamic Routing & Fleet Optimization ──────────────────────


class RoadNetworkEdge(Base):
    """Directed weighted edge in the NER road network topology graph."""
    __tablename__ = "road_network_edges"

    edge_id = Column(BigInteger, primary_key=True, autoincrement=True)
    source_node = Column(BigInteger, nullable=False, index=True)
    target_node = Column(BigInteger, nullable=False, index=True)
    road_name = Column(String(100), nullable=True)
    road_class = Column(String(50), nullable=True)  # 'NH', 'SH', 'MDR', 'RURAL'
    length_km = Column(Float, nullable=False)
    base_speed_kmh = Column(Float, nullable=False)
    base_duration_min = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    current_status = Column(
        Enum(RoadStatus), nullable=False, default=RoadStatus.CLEAR
    )
    current_hazard_penalty = Column(Float, default=0.0, nullable=False)
    geom = Column(Geometry("LINESTRING", srid=4326), nullable=False)


class VehicleTrip(Base):
    """Active vehicle mission with route assignment and reroute tracking."""
    __tablename__ = "vehicle_trips"

    trip_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id = Column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
    origin_name = Column(String(100), nullable=False)
    origin_coords = Column(Geometry("POINT", srid=4326), nullable=False)
    dest_name = Column(String(100), nullable=False)
    dest_coords = Column(Geometry("POINT", srid=4326), nullable=False)
    commodity_type = Column(
        Enum(CommodityType), nullable=False, default=CommodityType.GENERAL
    )
    priority_level = Column(
        Enum(TripPriority), nullable=False, default=TripPriority.STANDARD
    )
    status = Column(
        Enum(TripStatus), nullable=False, default=TripStatus.IN_TRANSIT
    )
    original_route_geom = Column(Geometry("LINESTRING", srid=4326), nullable=True)
    current_active_route = Column(Geometry("LINESTRING", srid=4326), nullable=True)
    estimated_arrival = Column(DateTime(timezone=True), nullable=True)
    last_rerouted_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    vehicle = relationship("Vehicle", back_populates="trips")
    reroute_logs = relationship("RerouteLog", back_populates="trip")


class RerouteLog(Base):
    """Audit trail for every rerouting decision."""
    __tablename__ = "reroute_logs"

    log_id = Column(BigInteger, primary_key=True, autoincrement=True)
    trip_id = Column(
        UUID(as_uuid=True), ForeignKey("vehicle_trips.trip_id"), nullable=False
    )
    trigger_reason = Column(String(100), nullable=False)
    old_eta = Column(DateTime(timezone=True), nullable=True)
    new_eta = Column(DateTime(timezone=True), nullable=True)
    delay_variance_minutes = Column(Integer, nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    trip = relationship("VehicleTrip", back_populates="reroute_logs")


# ── Stage 4 Models — Alert Dispatch & Analytics ────────────────────────────────


class AlertTier(str, enum.Enum):
    """Notification tier for the two-tier alert dispatch system."""
    CRITICAL = "CRITICAL"
    INFORMATIONAL = "INFORMATIONAL"


class AlertLog(Base):
    """Audit trail for dispatched alerts (both critical and batched)."""
    __tablename__ = "alert_logs"

    log_id = Column(BigInteger, primary_key=True, autoincrement=True)
    tier = Column(Enum(AlertTier), nullable=False)
    event_type = Column(String(100), nullable=False)
    severity = Column(String(50), nullable=True)
    message = Column(Text, nullable=False)
    source = Column(String(100), nullable=True, default="navner-ai")
    recipient = Column(String(200), nullable=True)
    delivery_status = Column(String(50), nullable=True, default="dispatched")
    vehicle_id = Column(UUID(as_uuid=True), nullable=True)
    trip_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

