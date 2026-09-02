"""Sync a Fleet Manager provisioning record into NavNER's operational database.

The Fleet Manager database (app.govt_models) is the source of truth for *what
was provisioned*. NavNER's database (app.models) is the source of truth for
*where things are and what they're doing* — position, trips, reroutes. A
registered vehicle is useless to the routing engine until it exists there too,
so this is the one place data crosses from one database to the other.

Deliberately a plain function called after a successful govt-DB write, not a
message queue or an outbox table — for a hackathon-scale fleet (tens to low
hundreds of vehicles) synchronous sync is simpler to reason about and there is
no requirement yet that survives a NavNER-DB outage. If that changes, the
`synced_to_navner` flag already on FleetVehicle is exactly what an outbox
retry loop would consume.
"""

from __future__ import annotations

from geoalchemy2.functions import ST_MakePoint
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.govt_models import FleetVehicle, GovtVehicleClass
from app.models import Vehicle, VehicleClass, VehicleStatus

# GovtVehicleClass and VehicleClass are separate enums in separate databases
# (see govt_models.py), so a value has to be translated rather than reused.
_CLASS_MAP = {c.value: VehicleClass[c.name] for c in GovtVehicleClass}


async def sync_vehicle_to_navner(
    navner_db: AsyncSession,
    fleet_vehicle: FleetVehicle,
    *,
    origin_coords: tuple[float, float] | None = None,
) -> Vehicle:
    """Create or update the NavNER-side Vehicle for a provisioning record.

    Keyed on license_plate — the two databases share no primary key, and the
    plate is the one identifier a human dispatcher actually reasons about.
    """
    existing = (
        await navner_db.execute(
            select(Vehicle).where(Vehicle.license_plate == fleet_vehicle.license_plate)
        )
    ).scalar_one_or_none()

    vehicle_class = _CLASS_MAP[fleet_vehicle.vehicle_class.value]

    if existing:
        existing.vehicle_class = vehicle_class
        existing.cargo_capacity_tons = fleet_vehicle.cargo_capacity_tons
        existing.depot_origin = fleet_vehicle.depot_origin
        existing.target_district = fleet_vehicle.target_district
        existing.organization = fleet_vehicle.organization
        vehicle = existing
    else:
        vehicle = Vehicle(
            name=fleet_vehicle.name or fleet_vehicle.license_plate,
            license_plate=fleet_vehicle.license_plate,
            organization=fleet_vehicle.organization,
            vehicle_class=vehicle_class,
            cargo_capacity_tons=fleet_vehicle.cargo_capacity_tons,
            depot_origin=fleet_vehicle.depot_origin,
            target_district=fleet_vehicle.target_district,
            status=VehicleStatus.active,
            created_at=fleet_vehicle.created_at,
        )
        if origin_coords:
            vehicle.current_location = ST_MakePoint(*origin_coords)
        navner_db.add(vehicle)

    await navner_db.flush()
    return vehicle
