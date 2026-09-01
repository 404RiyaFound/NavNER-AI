"""Open-Meteo weather data fetcher for NER environmental telemetry.

Provides async methods to retrieve real precipitation, soil moisture, and
temperature data for arbitrary coordinates via the free Open-Meteo API.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Open-Meteo free API (no key required)
OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast"

# Default NER corridor centroid (Guwahati region)
DEFAULT_LAT = 26.14
DEFAULT_LNG = 91.73

# Open-Meteo's native model resolution is roughly 11 km. H3 resolution-7 cells are
# ~1.22 km², so many neighbouring cells resolve to the same upstream grid square.
# Rounding coordinates to this many decimal places (1 dp ≈ 11 km) lets us collapse
# those into a single request instead of paying a round trip per hexagon.
WEATHER_GRID_PRECISION = 1

# Cap on simultaneous upstream requests — enough to be fast, few enough to stay
# polite to a free-tier API.
MAX_CONCURRENT_REQUESTS = 8

# Retry policy for transient upstream failures (notably HTTP 429 quota limits).
MAX_RETRIES = 3
BACKOFF_BASE_SECONDS = 1.5

# Reading provenance. Callers must branch on this rather than trusting the
# numbers: an unreachable upstream used to be indistinguishable from calm
# weather, which drove every cell to LOW and cleared the hazard map.
STATUS_OK = "ok"
STATUS_STALE = "stale"
STATUS_UNAVAILABLE = "unavailable"

# How old a stored reading may be and still be worth re-scoring from. Beyond
# this a cell is left at its previous assessment rather than re-scored.
STALE_TOLERANCE_HOURS = 6


async def fetch_weather_for_point(
    lat: float,
    lng: float,
    *,
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Fetch current weather conditions for a single coordinate.

    Returns a normalised dict with keys matching the WeatherTelemetryRecord
    model:  rainfall_1h_mm, rainfall_24h_mm, soil_saturation_pct,
            temperature_c, surface_runoff_rate
    """
    params = {
        "latitude": lat,
        "longitude": lng,
        "current": ",".join([
            "temperature_2m",
            "precipitation",
            "rain",
            "soil_moisture_0_to_7cm",
        ]),
        "hourly": "precipitation",
        "past_hours": 24,
        "forecast_hours": 0,
        "timezone": "auto",
    }

    try:
        data = await _get_with_retries(params, timeout=timeout)

        current = data.get("current", {})
        hourly = data.get("hourly", {})

        # Current 1-hour precipitation
        rainfall_1h = current.get("precipitation") or current.get("rain") or 0.0

        # 24-hour accumulated precipitation from hourly data
        precip_series = hourly.get("precipitation", [])
        rainfall_24h = sum(v for v in precip_series if v is not None) if precip_series else 0.0

        # Soil moisture → convert to percentage (0-1 m³/m³ → 0-100%)
        raw_soil = current.get("soil_moisture_0_to_7cm", 0.0) or 0.0
        soil_saturation_pct = min(raw_soil * 100 / 0.5, 100.0)  # 0.5 m³/m³ ≈ full saturation

        temperature_c = current.get("temperature_2m", 20.0)

        # Estimate surface runoff (simplified: rainfall intensity × soil saturation factor)
        saturation_factor = soil_saturation_pct / 100.0
        surface_runoff = rainfall_1h * (0.3 + 0.7 * saturation_factor)

        return {
            "status": STATUS_OK,
            "rainfall_1h_mm": round(float(rainfall_1h), 2),
            "rainfall_24h_mm": round(float(rainfall_24h), 2),
            "soil_saturation_pct": round(float(soil_saturation_pct), 2),
            "temperature_c": round(float(temperature_c), 2),
            "surface_runoff_rate": round(float(surface_runoff), 2),
        }

    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Open-Meteo HTTP error for (%s, %s): %s", lat, lng, exc.response.status_code
        )
    except httpx.RequestError as exc:
        logger.warning("Open-Meteo request error for (%s, %s): %s", lat, lng, exc)
    except Exception as exc:
        logger.warning("Unexpected error fetching weather for (%s, %s): %s", lat, lng, exc)

    # No fabricated readings. Zeros here were read downstream as a genuine
    # "no rain, dry soil" observation, so an Open-Meteo outage silently
    # rewrote every cell to LOW and destroyed the previous scores. Callers
    # must decide what to do with an absent reading.
    return {"status": STATUS_UNAVAILABLE}


async def fetch_weather_batch(
    coordinates: list[tuple[float, float]],
    *,
    timeout: float = 15.0,
) -> list[dict[str, Any]]:
    """Fetch weather for multiple coordinate pairs concurrently.

    Parameters
    ----------
    coordinates : list of (lat, lng) tuples

    Returns
    -------
    list of weather dicts (same order as input coordinates)
    """
    tasks = [
        fetch_weather_for_point(lat, lng, timeout=timeout)
        for lat, lng in coordinates
    ]
    return await asyncio.gather(*tasks)


async def _get_with_retries(params: dict[str, Any], *, timeout: float) -> dict[str, Any]:
    """GET the Open-Meteo forecast endpoint, retrying transient failures.

    Retries on HTTP 429 (free-tier quota) and 5xx, honouring ``Retry-After`` when
    the server supplies it. Raises the final exception if every attempt fails, so
    the caller decides how to degrade.
    """
    last_exc: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(OPEN_METEO_BASE, params=params)
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            status = exc.response.status_code
            if status != 429 and status < 500:
                raise  # client error — retrying will not help
            delay = BACKOFF_BASE_SECONDS * (2 ** attempt)
            retry_after = exc.response.headers.get("Retry-After")
            if retry_after:
                try:
                    delay = max(delay, float(retry_after))
                except ValueError:
                    pass
            if attempt < MAX_RETRIES - 1:
                logger.warning(
                    "Open-Meteo HTTP %s — retrying in %.1fs (attempt %d/%d)",
                    status, delay, attempt + 1, MAX_RETRIES,
                )
                await asyncio.sleep(delay)
        except httpx.RequestError as exc:
            last_exc = exc
            if attempt < MAX_RETRIES - 1:
                delay = BACKOFF_BASE_SECONDS * (2 ** attempt)
                logger.warning(
                    "Open-Meteo request error (%s) — retrying in %.1fs (attempt %d/%d)",
                    exc, delay, attempt + 1, MAX_RETRIES,
                )
                await asyncio.sleep(delay)

    assert last_exc is not None
    raise last_exc


async def fetch_weather_for_grid(
    coordinates: list[tuple[float, float]],
    *,
    timeout: float = 15.0,
) -> list[dict[str, Any]]:
    """Fetch weather for many coordinates concurrently, deduplicating by grid square.

    Coordinates that round to the same ~11 km Open-Meteo grid square share a single
    upstream request. Requests run concurrently under a semaphore rather than one at
    a time, which is what made the per-cell sequential loop unusable at grid scale.

    Returns
    -------
    list of weather dicts, one per input coordinate, in input order.
    """
    if not coordinates:
        return []

    # Group input indices by their rounded grid key.
    groups: dict[tuple[float, float], list[int]] = {}
    for idx, (lat, lng) in enumerate(coordinates):
        key = (round(lat, WEATHER_GRID_PRECISION), round(lng, WEATHER_GRID_PRECISION))
        groups.setdefault(key, []).append(idx)

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    async def fetch_key(key: tuple[float, float]) -> dict[str, Any]:
        async with semaphore:
            return await fetch_weather_for_point(key[0], key[1], timeout=timeout)

    keys = list(groups)
    results = await asyncio.gather(*(fetch_key(k) for k in keys))

    logger.info(
        "[Weather] Fetched %d grid squares for %d cells (%.0f%% fewer requests).",
        len(keys), len(coordinates),
        100 * (1 - len(keys) / len(coordinates)) if coordinates else 0,
    )

    out: list[dict[str, Any]] = [{}] * len(coordinates)
    for key, weather in zip(keys, results):
        for idx in groups[key]:
            out[idx] = weather
    return out


async def last_known_reading(db, h3_index: str):
    """Most recent stored reading for a cell, as a reading dict.

    Returns ``(reading, observed_at)``, or ``(None, None)`` when the cell has no
    stored telemetry. The reading carries ``status = STATUS_STALE`` so a caller
    cannot mistake it for a live observation.
    """
    # Imported here: models imports nothing from this module, but keeping the
    # dependency local avoids making the whole model layer a hard requirement
    # for the plain fetch helpers above.
    from sqlalchemy import select

    from app.models import WeatherTelemetryRecord

    record = (
        await db.execute(
            select(WeatherTelemetryRecord)
            .where(WeatherTelemetryRecord.h3_index == h3_index)
            .order_by(WeatherTelemetryRecord.timestamp.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if record is None:
        return None, None

    return {
        "status": STATUS_STALE,
        "rainfall_1h_mm": record.rainfall_1h_mm,
        "rainfall_24h_mm": record.rainfall_24h_mm,
        "soil_saturation_pct": record.soil_saturation_pct,
        "temperature_c": record.temperature_c,
        "surface_runoff_rate": record.surface_runoff_rate,
    }, record.timestamp


def is_within_stale_tolerance(observed_at, now) -> bool:
    """True when a stored reading is recent enough to re-score from."""
    from datetime import timedelta

    if observed_at is None:
        return False
    return (now - observed_at) <= timedelta(hours=STALE_TOLERANCE_HOURS)
