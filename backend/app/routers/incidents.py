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
from app.schemas import IncidentResponse, IncidentImageSyncResponse
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


@router.patch("/incidents/{readable_id}/image", response_model=IncidentImageSyncResponse)
async def sync_incident_image(
    readable_id: str,
    image: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Attach the deferred photo for a satellite-SMS incident (issue #74 §1).

    The SMS bridge plots the hazard immediately with image_url set to the
    "PENDING_NETWORK_SYNC" sentinel; the mobile app calls this once it
    reaches Wi-Fi or 4G and can finally push the high-resolution photo it has
    been holding in its local SQLite queue. Keyed on readable_id — the
    short id from the SMS payload — because that is the only identifier the
    phone has; it never learned the server-side UUID.
    """
    from sqlalchemy import select

    incident = (
        await db.execute(select(Incident).where(Incident.readable_id == readable_id))
    ).scalar_one_or_none()
    if incident is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"No incident with id {readable_id}")

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(image.filename or "")[1] or ".jpg"
    filename = f"{uuid_lib.uuid4().hex}{ext}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(await image.read())

    incident.image_url = f"/uploads/{filename}"
    await db.commit()

    await manager.broadcast(
        {
            "event": "incident_image_synced",
            "data": {"readable_id": readable_id, "image_url": incident.image_url},
        }
    )

    return IncidentImageSyncResponse(readable_id=readable_id, image_url=incident.image_url)
