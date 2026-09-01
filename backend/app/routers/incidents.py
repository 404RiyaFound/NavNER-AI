"""POST /api/v1/incident — Accept field incident reports with optional photo."""

import os
import uuid as uuid_lib
from datetime import datetime, timezone

import aiofiles
from fastapi import APIRouter, Depends, File, Form, UploadFile
from geoalchemy2.functions import ST_MakePoint
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Incident, IncidentType
from app.schemas import IncidentResponse
from app.websocket import manager

router = APIRouter(prefix="/api/v1", tags=["incidents"])


@router.post("/incident", response_model=IncidentResponse, status_code=201)
async def create_incident(
    type: IncidentType = Form(...),
    lat: float = Form(..., ge=-90, le=90),
    lng: float = Form(..., ge=-180, le=180),
    description: str = Form(None),
    reported_by: str = Form(None),
    image: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Accept a multipart form with incident data and an optional geo-tagged photo.
    Saves the image locally and broadcasts the new incident to dashboard clients.
    """
    image_url = None

    # Save uploaded image to local storage
    if image and image.filename:
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
        ext = os.path.splitext(image.filename)[1] or ".jpg"
        filename = f"{uuid_lib.uuid4().hex}{ext}"
        filepath = os.path.join(settings.UPLOAD_DIR, filename)

        async with aiofiles.open(filepath, "wb") as f:
            content = await image.read()
            await f.write(content)

        image_url = f"/uploads/{filename}"

    point = ST_MakePoint(lng, lat)
    now = datetime.now(timezone.utc)

    reporter_id = None
    if reported_by:
        try:
            reporter_id = uuid_lib.UUID(reported_by)
        except ValueError:
            pass

    incident = Incident(
        type=type,
        location=point,
        image_url=image_url,
        description=description,
        reported_by=reporter_id,
        created_at=now,
    )
    db.add(incident)
    await db.flush()

    # `location` was assigned a SQL expression (ST_MakePoint), so it is expired
    # after the flush. Load it eagerly here — the downstream reroute trigger reads
    # it, and an implicit lazy load would raise MissingGreenlet under asyncio.
    await db.refresh(incident, ["location"])

    # Trigger potential reroutes for active fleets
    from app.services.reroute_trigger import trigger_incident_reroute
    await trigger_incident_reroute(incident, db)

    # Dispatch alert
    from app.alert_dispatcher import alert_dispatcher
    severity = "CRITICAL" if type.value in ["landslide", "bridge_collapse"] else "INFORMATIONAL"
    await alert_dispatcher.process_event({
        "event_type": type.value,
        "severity": severity,
        "message": description or f"New {type.value} reported.",
        "source": "field_app",
        "location": {"lat": lat, "lng": lng}
    })

    # Broadcast new incident to dashboard clients
    await manager.broadcast(
        {
            "event": "new_incident",
            "data": {
                "id": str(incident.id),
                "type": type.value,
                "lat": lat,
                "lng": lng,
                "description": description,
                "image_url": image_url,
                "status": "open",
                "created_at": now.isoformat(),
            },
        }
    )

    return IncidentResponse(
        id=incident.id,
        type=type,
        lat=lat,
        lng=lng,
        image_url=image_url,
        description=description,
        status=incident.status,
        reported_by=reporter_id,
        created_at=now,
    )
