"""POST /api/v1/telemetry — Ingest GPS pings from vehicles."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from geoalchemy2.functions import ST_MakePoint
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Telemetry, Vehicle
from app.schemas import TelemetryCreate, TelemetryResponse
from app.websocket import manager

router = APIRouter(prefix="/api/v1", tags=["telemetry"])


@router.post("/telemetry", response_model=TelemetryResponse, status_code=201)
async def ingest_telemetry(
    payload: TelemetryCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Receive a GPS ping from a vehicle, store it as a telemetry record,
    update the vehicle's current location, and broadcast to dashboard clients.
    """
    point = ST_MakePoint(payload.lng, payload.lat)
    now = datetime.now(timezone.utc)

    # Insert telemetry record
    record = Telemetry(
        vehicle_id=payload.vehicle_id,
        location=point,
        speed=payload.speed,
        timestamp=now,
    )
    db.add(record)
    await db.flush()

    # Update vehicle's current location and last_ping
    await db.execute(
        update(Vehicle)
        .where(Vehicle.id == payload.vehicle_id)
        .values(current_location=point, last_ping=now)
    )

    # Broadcast live update to all connected dashboard clients
    await manager.broadcast(
        {
            "event": "telemetry_update",
            "data": {
                "vehicle_id": str(payload.vehicle_id),
                "lat": payload.lat,
                "lng": payload.lng,
                "speed": payload.speed,
                "timestamp": now.isoformat(),
            },
        }
    )

    return TelemetryResponse(
        id=record.id,
        vehicle_id=payload.vehicle_id,
        lat=payload.lat,
        lng=payload.lng,
        speed=payload.speed,
        timestamp=now,
    )
