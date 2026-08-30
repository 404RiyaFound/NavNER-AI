"""Seed the database with demo data for development."""

from datetime import datetime, timezone

from geoalchemy2.functions import ST_MakePoint
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Incident,
    IncidentType,
    User,
    UserRole,
    Vehicle,
    VehicleStatus,
    VehicleType,
)


async def seed_demo_data(db: AsyncSession) -> None:
    """Insert demo users, vehicles, and incidents if the database is empty."""

    # Skip if data already exists
    existing = (await db.execute(select(User.id).limit(1))).first()
    if existing:
        return

    # ── Users ──────────────────────────────────────────────────────────────
    admin = User(
        name="Rajesh Kumar",
        role=UserRole.admin,
        district="Kamrup Metropolitan",
        auth_token="demo-admin-token",
    )
    field_officer_1 = User(
        name="Anita Devi",
        role=UserRole.field_official,
        district="East Khasi Hills",
        auth_token="demo-field-token-1",
    )
    field_officer_2 = User(
        name="Biren Singh",
        role=UserRole.field_official,
        district="Imphal West",
        auth_token="demo-field-token-2",
    )
    db.add_all([admin, field_officer_1, field_officer_2])
    await db.flush()

    # ── Vehicles ───────────────────────────────────────────────────────────
    # Positioned across key NER locations
    vehicles = [
        Vehicle(
            name="NER-TRUCK-001",
            type=VehicleType.truck,
            status=VehicleStatus.active,
            current_location=ST_MakePoint(91.7362, 26.1445),  # Guwahati
            last_ping=datetime.now(timezone.utc),
        ),
        Vehicle(
            name="NER-TRUCK-002",
            type=VehicleType.truck,
            status=VehicleStatus.active,
            current_location=ST_MakePoint(91.8933, 25.5788),  # Shillong
            last_ping=datetime.now(timezone.utc),
        ),
        Vehicle(
            name="NER-AMB-001",
            type=VehicleType.ambulance,
            status=VehicleStatus.active,
            current_location=ST_MakePoint(93.9368, 24.8170),  # Imphal
            last_ping=datetime.now(timezone.utc),
        ),
        Vehicle(
            name="NER-UTIL-001",
            type=VehicleType.utility,
            status=VehicleStatus.active,
            current_location=ST_MakePoint(94.9120, 27.4728),  # Dibrugarh
            last_ping=datetime.now(timezone.utc),
        ),
        Vehicle(
            name="NER-TRUCK-003",
            type=VehicleType.truck,
            status=VehicleStatus.inactive,
            current_location=ST_MakePoint(92.7176, 26.7509),  # Tezpur
            last_ping=datetime.now(timezone.utc),
        ),
    ]
    db.add_all(vehicles)
    await db.flush()

    # ── Incidents ──────────────────────────────────────────────────────────
    incidents = [
        Incident(
            type=IncidentType.landslide,
            location=ST_MakePoint(91.5860, 25.6751),  # Near Shillong
            description="Major landslide blocking NH-6 near Umiam. "
            "Approximately 50m of road covered with debris. "
            "No casualties reported.",
            status="open",
            reported_by=field_officer_1.id,
            created_at=datetime.now(timezone.utc),
        ),
        Incident(
            type=IncidentType.flood,
            location=ST_MakePoint(92.8347, 26.7428),  # Near Tezpur
            description="Flash flood on Brahmaputra tributary. "
            "Road submerged under 2ft of water near Tezpur bypass. "
            "Vehicles being diverted via alternate route.",
            status="open",
            reported_by=field_officer_2.id,
            created_at=datetime.now(timezone.utc),
        ),
        Incident(
            type=IncidentType.road_damage,
            location=ST_MakePoint(93.6907, 25.3653),  # Near Churachandpur
            description="Severe pothole damage on state highway. "
            "Heavy vehicle passage restricted. "
            "Repair crew dispatched.",
            status="in_progress",
            reported_by=field_officer_1.id,
            created_at=datetime.now(timezone.utc),
        ),
    ]
    db.add_all(incidents)
    await db.flush()

    await db.commit()
    print("✅ Demo data seeded successfully.")
