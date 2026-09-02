"""Deterministic telemetry simulation along real road geometry.

Private logistics operators do not expose live GPS feeds, so demos and local
development need vehicle movement that looks real without depending on a
third-party feed being up at presentation time.

This module fetches a genuine driving polyline from OSRM once, caches it on
disk, then advances each simulated vehicle along that polyline at a fixed
ground speed. Positions are broadcast as the same ``telemetry_update`` event
the real telemetry endpoint emits, so the dashboard needs no special handling.

If OSRM is unreachable and no cache exists, a small hardcoded NH-27 corridor
polyline is used instead — the simulation degrades in fidelity but never fails,
which is the point of choosing simulation over a live proxy feed.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path

import httpx
from geoalchemy2.functions import ST_MakePoint
from sqlalchemy import select, update

from app.config import settings
from app.database import async_session
from app.models import Telemetry, Vehicle
from app.websocket import manager

logger = logging.getLogger(__name__)

EARTH_RADIUS_M = 6_371_000.0

# Guwahati → Jorabat → Nongpoh → Shillong, the NH-27/NH-6 corridor the seeded
# hazard cells sit on. Used as OSRM waypoints, and as the fallback polyline.
CORRIDOR_WAYPOINTS: list[tuple[float, float]] = [
    (91.7362, 26.1445),  # Guwahati
    (91.8000, 26.1100),  # Jorabat
    (91.8780, 25.9000),  # Nongpoh
    (91.8933, 25.5788),  # Shillong
]


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in metres between two (lng, lat) points."""
    lng1, lat1 = a
    lng2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def _cache_path() -> Path:
    return Path(settings.SIM_ROUTE_CACHE)


async def load_corridor_polyline() -> list[tuple[float, float]]:
    """Return the driving polyline for the demo corridor.

    Disk cache first, then OSRM, then the hardcoded waypoints. The cache means a
    presentation never depends on OSRM being reachable.
    """
    cache = _cache_path()
    if cache.exists():
        try:
            coords = json.loads(cache.read_text())
            if isinstance(coords, list) and len(coords) > 1:
                logger.info("[Simulator] Loaded %d cached route points", len(coords))
                return [(float(lng), float(lat)) for lng, lat in coords]
        except (OSError, ValueError, TypeError) as exc:
            logger.warning("[Simulator] Ignoring unreadable route cache: %s", exc)

    path = ";".join(f"{lng},{lat}" for lng, lat in CORRIDOR_WAYPOINTS)
    url = (
        f"{settings.OSRM_BASE_URL.rstrip('/')}/route/v1/driving/{path}"
        "?overview=full&geometries=geojson"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
        coords = [
            (float(lng), float(lat))
            for lng, lat in data["routes"][0]["geometry"]["coordinates"]
        ]
        if len(coords) < 2:
            raise ValueError("OSRM returned a degenerate geometry")
    except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
        logger.warning(
            "[Simulator] OSRM unavailable (%s) — falling back to the "
            "hardcoded corridor. Movement will follow straight legs between "
            "waypoints rather than the real road centreline.",
            exc,
        )
        return list(CORRIDOR_WAYPOINTS)

    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(coords))
        logger.info("[Simulator] Cached %d route points to %s", len(coords), cache)
    except OSError as exc:
        logger.warning("[Simulator] Could not write route cache: %s", exc)

    return coords


class RouteSimulator:
    """Advances vehicles along a fixed polyline, one tick at a time.

    Each vehicle gets its own offset along the route so they do not overlap, and
    wraps back to the start on completion, giving an indefinitely running demo.
    """

    def __init__(self) -> None:
        self._polyline: list[tuple[float, float]] = []
        self._cumulative_m: list[float] = []
        self._total_m: float = 0.0
        self._offsets_m: dict[str, float] = {}
        self._vehicle_ids: list[str] = []
        self._tick: int = 0

    @property
    def ready(self) -> bool:
        return self._total_m > 0 and bool(self._vehicle_ids)

    async def prepare(self) -> None:
        """Load geometry and pick the vehicles to drive. Safe to call repeatedly."""
        if not self._polyline:
            self._polyline = await load_corridor_polyline()
            self._cumulative_m = [0.0]
            for prev, curr in zip(self._polyline, self._polyline[1:]):
                self._cumulative_m.append(
                    self._cumulative_m[-1] + _haversine_m(prev, curr)
                )
            self._total_m = self._cumulative_m[-1]

        if self._vehicle_ids:
            return

        async with async_session() as db:
            rows = (
                await db.execute(
                    select(Vehicle.id).order_by(Vehicle.name).limit(
                        settings.SIM_VEHICLE_LIMIT
                    )
                )
            ).scalars().all()

        self._vehicle_ids = [str(v) for v in rows]
        if not self._vehicle_ids:
            logger.warning("[Simulator] No vehicles in the database to simulate.")
            return

        # Spread vehicles evenly around the loop.
        spacing = self._total_m / len(self._vehicle_ids)
        for index, vehicle_id in enumerate(self._vehicle_ids):
            self._offsets_m[vehicle_id] = spacing * index

        logger.info(
            "[Simulator] Driving %d vehicles over %.1f km of route geometry",
            len(self._vehicle_ids),
            self._total_m / 1000,
        )

    def _interpolate(self, distance_m: float) -> tuple[float, float]:
        """Position at ``distance_m`` along the polyline, wrapping at the end."""
        d = distance_m % self._total_m
        # cumulative_m is sorted, so walk forward to the containing segment.
        hi = 1
        while hi < len(self._cumulative_m) - 1 and self._cumulative_m[hi] < d:
            hi += 1
        lo = hi - 1
        span = self._cumulative_m[hi] - self._cumulative_m[lo]
        t = 0.0 if span <= 0 else (d - self._cumulative_m[lo]) / span
        (lng1, lat1), (lng2, lat2) = self._polyline[lo], self._polyline[hi]
        return (lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t)

    async def step(self) -> int:
        """Advance every simulated vehicle by one tick. Returns vehicles moved."""
        await self.prepare()
        if not self.ready:
            return 0

        self._tick += 1
        now = datetime.now(timezone.utc)
        speed_kmph = settings.SIM_SPEED_KMPH
        advance_m = (speed_kmph * 1000 / 3600) * settings.SIM_INTERVAL_SECONDS
        persist_telemetry = self._tick % settings.SIM_TELEMETRY_EVERY == 0

        moved = 0
        async with async_session() as db:
            for vehicle_id in self._vehicle_ids:
                self._offsets_m[vehicle_id] += advance_m
                lng, lat = self._interpolate(self._offsets_m[vehicle_id])
                point = ST_MakePoint(lng, lat)

                # Keep the stored position current so a page reload does not snap
                # markers back to their seeded coordinates.
                await db.execute(
                    update(Vehicle)
                    .where(Vehicle.id == vehicle_id)
                    .values(current_location=point, last_ping=now)
                )

                # Telemetry history is written at a coarser cadence than the
                # broadcast, so a long-running demo does not flood the table.
                if persist_telemetry:
                    db.add(
                        Telemetry(
                            vehicle_id=vehicle_id,
                            location=ST_MakePoint(lng, lat),
                            speed=speed_kmph,
                            timestamp=now,
                        )
                    )

                await manager.broadcast(
                    {
                        "event": "telemetry_update",
                        "data": {
                            "vehicle_id": vehicle_id,
                            "lat": lat,
                            "lng": lng,
                            "speed": speed_kmph,
                            "timestamp": now.isoformat(),
                            "simulated": True,
                        },
                    }
                )
                moved += 1

            await db.commit()

        return moved


simulator = RouteSimulator()


async def run_simulation_tick() -> dict:
    """Scheduler entry point."""
    moved = await simulator.step()
    return {"vehicles_moved": moved}
