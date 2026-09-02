"""GET /api/v1/map-state — Return active vehicles and unresolved incidents."""

from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends

from app.database import get_db
from app.models import Incident, IncidentStatus, Vehicle, VehicleStatus
from app.schemas import IncidentResponse, MapStateResponse, VehicleResponse

router = APIRouter(prefix="/api/v1", tags=["map"])


@router.get("/map-state", response_model=MapStateResponse)
async def get_map_state(db: AsyncSession = Depends(get_db)):
    """
    Hydrate the web dashboard on initial load with all active vehicles
    and all unresolved incidents.
    """
    # ── Vehicles ───────────────────────────────────────────────────────────
    vehicle_stmt = select(
        Vehicle.id,
        Vehicle.name,
        Vehicle.type,
        Vehicle.status,
        Vehicle.license_plate,
        Vehicle.organization,
        ST_Y(Vehicle.current_location).label("lat"),
        ST_X(Vehicle.current_location).label("lng"),
        Vehicle.last_ping,
    ).where(Vehicle.status == VehicleStatus.active)

    vehicle_rows = (await db.execute(vehicle_stmt)).all()

    vehicles = [
        VehicleResponse(
            id=row.id,
            name=row.name,
            type=row.type,
            status=row.status,
            license_plate=row.license_plate,
            organization=row.organization,
            lat=row.lat,
            lng=row.lng,
            last_ping=row.last_ping,
        )
        for row in vehicle_rows
    ]

    # ── Incidents ──────────────────────────────────────────────────────────
    incident_stmt = select(
        Incident.id,
        Incident.type,
        ST_Y(Incident.location).label("lat"),
        ST_X(Incident.location).label("lng"),
        Incident.image_url,
        Incident.description,
        Incident.status,
        Incident.reported_by,
        Incident.created_at,
    ).where(Incident.status != IncidentStatus.resolved).order_by(Incident.created_at.desc())

    incident_rows = (await db.execute(incident_stmt)).all()

    incidents = [
        IncidentResponse(
            id=row.id,
            type=row.type,
            lat=row.lat,
            lng=row.lng,
            image_url=row.image_url,
            description=row.description,
            status=row.status,
            reported_by=row.reported_by,
            created_at=row.created_at,
        )
        for row in incident_rows
    ]

    return MapStateResponse(vehicles=vehicles, incidents=incidents)
