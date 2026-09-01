"""Seed the database with demo data for development."""

from datetime import datetime, timezone

import h3
from geoalchemy2.functions import ST_GeomFromText, ST_MakePoint
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Incident,
    IncidentType,
    RiskLevel,
    SegmentRiskAssessment,
    SpatialGridCell,
    User,
    UserRole,
    Vehicle,
    VehicleStatus,
    VehicleType,
    WeatherTelemetryRecord,
)


def _h3_boundary_to_wkt(h3_index: str) -> str:
    """Convert an H3 index to a WKT POLYGON string."""
    boundary = h3.cell_to_boundary(h3_index)
    # h3 returns (lat, lng) pairs — WKT needs (lng, lat)
    coords = ", ".join(f"{lng} {lat}" for lat, lng in boundary)
    # Close the ring
    first = boundary[0]
    coords += f", {first[1]} {first[0]}"
    return f"POLYGON(({coords}))"


# Representative H3 cells across NER corridors (Resolution 7 ~ 1.22 km²)
NER_GRID_CELLS = [
    # Guwahati corridor (Assam)
    {"lat": 26.1445, "lng": 91.7362, "state": "Assam", "district": "Kamrup Metropolitan",
     "slope": 5.2, "elevation": 55, "susceptibility": 0.15},
    {"lat": 26.1800, "lng": 91.7800, "state": "Assam", "district": "Kamrup Metropolitan",
     "slope": 8.1, "elevation": 85, "susceptibility": 0.20},

    # Shillong corridor (Meghalaya)
    {"lat": 25.5788, "lng": 91.8933, "state": "Meghalaya", "district": "East Khasi Hills",
     "slope": 32.5, "elevation": 1496, "susceptibility": 0.72},
    {"lat": 25.6200, "lng": 91.8500, "state": "Meghalaya", "district": "East Khasi Hills",
     "slope": 38.0, "elevation": 1350, "susceptibility": 0.80},
    {"lat": 25.6751, "lng": 91.5860, "state": "Meghalaya", "district": "Ri-Bhoi",
     "slope": 28.5, "elevation": 900, "susceptibility": 0.65},

    # Imphal corridor (Manipur)
    {"lat": 24.8170, "lng": 93.9368, "state": "Manipur", "district": "Imphal West",
     "slope": 12.3, "elevation": 786, "susceptibility": 0.35},
    {"lat": 24.7500, "lng": 93.8800, "state": "Manipur", "district": "Bishnupur",
     "slope": 6.8, "elevation": 780, "susceptibility": 0.25},

    # Dibrugarh corridor (Assam)
    {"lat": 27.4728, "lng": 94.9120, "state": "Assam", "district": "Dibrugarh",
     "slope": 3.1, "elevation": 108, "susceptibility": 0.10},
    {"lat": 27.5000, "lng": 95.0000, "state": "Assam", "district": "Tinsukia",
     "slope": 4.5, "elevation": 116, "susceptibility": 0.12},

    # Tezpur corridor (Assam)
    {"lat": 26.7509, "lng": 92.7176, "state": "Assam", "district": "Sonitpur",
     "slope": 7.8, "elevation": 78, "susceptibility": 0.18},

    # Churachandpur (Manipur) — hilly terrain
    {"lat": 25.3653, "lng": 93.6907, "state": "Manipur", "district": "Churachandpur",
     "slope": 35.2, "elevation": 1150, "susceptibility": 0.70},

    # Aizawl corridor (Mizoram)
    {"lat": 23.7271, "lng": 92.7176, "state": "Mizoram", "district": "Aizawl",
     "slope": 40.0, "elevation": 1132, "susceptibility": 0.78},
    {"lat": 23.6800, "lng": 92.7500, "state": "Mizoram", "district": "Aizawl",
     "slope": 36.5, "elevation": 1050, "susceptibility": 0.73},

    # Kohima (Nagaland)
    {"lat": 25.6700, "lng": 94.1100, "state": "Nagaland", "district": "Kohima",
     "slope": 33.0, "elevation": 1261, "susceptibility": 0.68},

    # Gangtok corridor (Sikkim)
    {"lat": 27.3314, "lng": 88.6138, "state": "Sikkim", "district": "East Sikkim",
     "slope": 42.0, "elevation": 1650, "susceptibility": 0.82},
    {"lat": 27.2800, "lng": 88.5800, "state": "Sikkim", "district": "East Sikkim",
     "slope": 38.5, "elevation": 1480, "susceptibility": 0.76},

    # Agartala (Tripura) — relatively flat
    {"lat": 23.8315, "lng": 91.2868, "state": "Tripura", "district": "West Tripura",
     "slope": 4.2, "elevation": 13, "susceptibility": 0.08},

    # Silchar (Assam — Barak Valley)
    {"lat": 24.8333, "lng": 92.7789, "state": "Assam", "district": "Cachar",
     "slope": 9.5, "elevation": 35, "susceptibility": 0.22},

    # NH-6 corridor (Meghalaya)
    {"lat": 25.5000, "lng": 91.7000, "state": "Meghalaya", "district": "East Khasi Hills",
     "slope": 34.0, "elevation": 1280, "susceptibility": 0.75},
    {"lat": 25.4500, "lng": 91.6500, "state": "Meghalaya", "district": "East Khasi Hills",
     "slope": 30.0, "elevation": 1100, "susceptibility": 0.68},
]

# Initial risk assessments (varying levels for demo)
INITIAL_RISK_DATA = {
    # (landslide_score, flood_score, risk_level, blockage_prob, factor)
    "Kamrup Metropolitan": (0.12, 0.25, "LOW", 0.08, "Normal conditions — low terrain risk"),
    "East Khasi Hills": (0.78, 0.35, "HIGH", 0.72, "Heavy precipitation on steep slope (35°)"),
    "Ri-Bhoi": (0.62, 0.30, "MODERATE", 0.55, "Elevated landslide conditions (slope 28°, rain 80mm)"),
    "Imphal West": (0.30, 0.22, "LOW", 0.18, "Normal conditions — moderate terrain"),
    "Bishnupur": (0.20, 0.18, "LOW", 0.12, "Normal conditions — low terrain risk"),
    "Dibrugarh": (0.08, 0.45, "MODERATE", 0.35, "Waterlogging risk (rainfall 25mm/hr, low drainage)"),
    "Tinsukia": (0.10, 0.40, "MODERATE", 0.30, "Waterlogging risk (rainfall 20mm/hr, low drainage)"),
    "Sonitpur": (0.15, 0.38, "MODERATE", 0.28, "Waterlogging risk — Brahmaputra proximity"),
    "Churachandpur": (0.72, 0.28, "HIGH", 0.68, "Prolonged rainfall (150mm/24h) on unstable terrain"),
    "Aizawl": (0.88, 0.32, "CRITICAL", 0.90, "Heavy precipitation on steep slope (40°)"),
    "Kohima": (0.70, 0.30, "HIGH", 0.65, "Heavy precipitation on steep slope (33°)"),
    "East Sikkim": (0.92, 0.28, "CRITICAL", 0.95, "Heavy precipitation on steep slope (42°)"),
    "West Tripura": (0.06, 0.15, "LOW", 0.05, "Normal conditions — flat terrain"),
    "Cachar": (0.18, 0.52, "MODERATE", 0.42, "Sustained flooding — Barak Valley low elevation"),
}


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

    # ── Stage 2: H3 Spatial Grid Cells ─────────────────────────────────────
    now = datetime.now(timezone.utc)

    for cell_info in NER_GRID_CELLS:
        # Get H3 index for this coordinate at resolution 7
        h3_index = h3.latlng_to_cell(cell_info["lat"], cell_info["lng"], 7)

        # Convert H3 boundary to WKT polygon
        wkt = _h3_boundary_to_wkt(h3_index)

        grid_cell = SpatialGridCell(
            h3_index=h3_index,
            geom=ST_GeomFromText(wkt, 4326),
            state=cell_info["state"],
            district=cell_info["district"],
            avg_slope_degrees=cell_info["slope"],
            elevation_meters=cell_info["elevation"],
            landslide_susceptibility_base=cell_info["susceptibility"],
        )
        db.add(grid_cell)
        await db.flush()

        # Add initial risk assessment
        risk_data = INITIAL_RISK_DATA.get(cell_info["district"])
        if risk_data:
            ls_score, fl_score, level, blockage, factor = risk_data
            risk_assessment = SegmentRiskAssessment(
                h3_index=h3_index,
                last_evaluated=now,
                landslide_risk_score=ls_score,
                flood_risk_score=fl_score,
                composite_risk_level=RiskLevel(level),
                predicted_blockage_probability=blockage,
                primary_contributing_factor=factor,
            )
            db.add(risk_assessment)

        # Add initial weather telemetry record
        weather_record = WeatherTelemetryRecord(
            h3_index=h3_index,
            timestamp=now,
            rainfall_1h_mm=cell_info["slope"] * 0.5 + 5,  # Synthetic initial data
            rainfall_24h_mm=cell_info["slope"] * 2.5 + 20,
            soil_saturation_pct=min(cell_info["susceptibility"] * 80 + 15, 100),
            temperature_c=25 - cell_info["elevation"] * 0.006,  # Lapse rate
            surface_runoff_rate=cell_info["slope"] * 0.02,
        )
        db.add(weather_record)

    await db.flush()
    await db.commit()
    print("✅ Demo data seeded successfully (Stage 1 + Stage 2 grid cells).")
