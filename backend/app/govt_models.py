"""Fleet Manager database models — the government provisioning system of record.

Separate declarative Base and separate database from app.models on purpose.
This table holds exactly what a dispatcher types into the registration form:
no geometry, no telemetry, no images. Live position, trips and routing all
still live in NavNER's own database — see app.services.govt_sync for how a
provisioning record becomes a routable vehicle there.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base

GovtBase = declarative_base()


class GovtVehicleClass(str, enum.Enum):
    """Mirrors app.models.VehicleClass. Kept as its own enum rather than an
    import across databases, since the two schemas are meant to be able to
    evolve independently — that is the point of splitting them."""

    HEAVY_TRUCK = "HEAVY_TRUCK"
    PICKUP_4X4 = "PICKUP_4X4"
    AMBULANCE = "AMBULANCE"
    NDRF_BOAT = "NDRF_BOAT"
    UTILITY = "UTILITY"


class FleetVehicle(GovtBase):
    """One government-provisioned vehicle. The authoritative registration
    record — license_plate is the join key used to sync into NavNER's
    vehicles table, not a surrogate id shared across the two databases."""

    __tablename__ = "fleet_vehicles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    license_plate = Column(String(20), nullable=False, unique=True, index=True)
    name = Column(String(120), nullable=True)
    organization = Column(String(100), nullable=True)
    vehicle_class = Column(Enum(GovtVehicleClass), nullable=False)
    cargo_capacity_tons = Column(Float, nullable=False)
    depot_origin = Column(String(120), nullable=False)
    target_district = Column(String(120), nullable=False)

    # Set once sync_vehicle_to_navner() has created the corresponding row in
    # NavNER's own database. A registration that failed to sync (NavNER
    # database briefly unreachable, say) is still visible here as
    # provisioned-but-not-yet-operational, rather than lost.
    synced_to_navner = Column(Boolean, nullable=False, default=False)

    created_at = Column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
