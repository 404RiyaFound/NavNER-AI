"""Open-Meteo weather data fetcher for NER environmental telemetry.

Provides async methods to retrieve real precipitation, soil moisture, and
temperature data for arbitrary coordinates via the free Open-Meteo API.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Open-Meteo free API (no key required)
OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast"

# Default NER corridor centroid (Guwahati region)
DEFAULT_LAT = 26.14
DEFAULT_LNG = 91.73


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
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(OPEN_METEO_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()

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

    # Fallback: return zeros so the pipeline doesn't break
    return {
        "rainfall_1h_mm": 0.0,
        "rainfall_24h_mm": 0.0,
        "soil_saturation_pct": 0.0,
        "temperature_c": 20.0,
        "surface_runoff_rate": 0.0,
    }


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
    import asyncio

    tasks = [
        fetch_weather_for_point(lat, lng, timeout=timeout)
        for lat, lng in coordinates
    ]
    return await asyncio.gather(*tasks)
