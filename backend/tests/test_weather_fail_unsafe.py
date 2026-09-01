"""Tests for fail-safe handling of Open-Meteo outages.

Covers the defect where an unreachable upstream returned zeros for every field,
which the risk engine consumed as a genuine "no rain, dry soil" observation.
Every cell scored LOW, the stored assessments were overwritten, the routing
hazard penalty dropped, and the hazard map turned green — during exactly the
conditions the platform exists to warn about.
"""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app import weather_service
from app.weather_service import (
    STALE_TOLERANCE_HOURS,
    STATUS_OK,
    STATUS_STALE,
    STATUS_UNAVAILABLE,
    fetch_weather_for_point,
    is_within_stale_tolerance,
)


class TestFailureIsDistinguishable:
    """An outage must never look like calm weather."""

    @pytest.mark.asyncio
    async def test_request_error_reports_unavailable(self, monkeypatch):
        async def _boom(params, *, timeout):
            raise httpx.RequestError("connection refused")

        monkeypatch.setattr(weather_service, "_get_with_retries", _boom)
        reading = await fetch_weather_for_point(26.14, 91.73)

        assert reading["status"] == STATUS_UNAVAILABLE

    @pytest.mark.asyncio
    async def test_failure_carries_no_fabricated_readings(self, monkeypatch):
        """The regression itself: zeros were indistinguishable from real data."""

        async def _boom(params, *, timeout):
            raise httpx.RequestError("connection refused")

        monkeypatch.setattr(weather_service, "_get_with_retries", _boom)
        reading = await fetch_weather_for_point(26.14, 91.73)

        for field in (
            "rainfall_1h_mm",
            "rainfall_24h_mm",
            "soil_saturation_pct",
            "surface_runoff_rate",
        ):
            assert field not in reading, (
                f"{field} present on a failed fetch — a caller could read it as "
                "a real observation"
            )

    @pytest.mark.asyncio
    async def test_http_error_reports_unavailable(self, monkeypatch):
        async def _boom(params, *, timeout):
            raise httpx.HTTPStatusError(
                "429",
                request=httpx.Request("GET", "https://api.open-meteo.com"),
                response=httpx.Response(429),
            )

        monkeypatch.setattr(weather_service, "_get_with_retries", _boom)
        assert (await fetch_weather_for_point(26.14, 91.73))["status"] == (
            STATUS_UNAVAILABLE
        )

    @pytest.mark.asyncio
    async def test_successful_fetch_is_tagged_ok(self, monkeypatch):
        async def _ok(params, *, timeout):
            return {
                "current": {
                    "precipitation": 4.0,
                    "soil_moisture_0_to_7cm": 0.4,
                    "temperature_2m": 21.0,
                },
                "hourly": {"precipitation": [1.0, 2.0, 3.0]},
            }

        monkeypatch.setattr(weather_service, "_get_with_retries", _ok)
        reading = await fetch_weather_for_point(26.14, 91.73)

        assert reading["status"] == STATUS_OK
        assert reading["rainfall_1h_mm"] == 4.0
        assert reading["rainfall_24h_mm"] == 6.0


class TestStaleTolerance:
    def test_recent_reading_is_usable(self):
        now = datetime.now(timezone.utc)
        assert is_within_stale_tolerance(now - timedelta(minutes=30), now)

    def test_reading_at_the_boundary_is_usable(self):
        now = datetime.now(timezone.utc)
        edge = now - timedelta(hours=STALE_TOLERANCE_HOURS)
        assert is_within_stale_tolerance(edge, now)

    def test_reading_past_tolerance_is_rejected(self):
        now = datetime.now(timezone.utc)
        assert not is_within_stale_tolerance(
            now - timedelta(hours=STALE_TOLERANCE_HOURS + 1), now
        )

    def test_absent_reading_is_rejected(self):
        assert not is_within_stale_tolerance(None, datetime.now(timezone.utc))


class TestZeroedWeatherHidesHazards:
    """Why fabricated zeros were dangerous, not merely inaccurate.

    Measured against the shipped model: zeroed weather does not flatten every
    cell to LOW as first reported — terrain alone keeps steeper cells at
    MODERATE. What it does consistently is *downgrade*, so a cell that real
    conditions put at HIGH is reported one band lower.
    """

    ZEROED = {
        "rainfall_1h_mm": 0.0,
        "rainfall_24h_mm": 0.0,
        "soil_saturation_pct": 0.0,
        "temperature_c": 20.0,
        "surface_runoff_rate": 0.0,
    }
    WET = {
        "rainfall_1h_mm": 22.0,
        "rainfall_24h_mm": 180.0,
        "soil_saturation_pct": 95.0,
        "temperature_c": 19.0,
        "surface_runoff_rate": 18.0,
    }
    TERRAIN = {
        "steep": {
            "avg_slope_degrees": 42.0,
            "elevation_meters": 1500.0,
            "landslide_susceptibility_base": 0.8,
        },
        "moderate": {
            "avg_slope_degrees": 18.0,
            "elevation_meters": 600.0,
            "landslide_susceptibility_base": 0.35,
        },
        "gentle": {
            "avg_slope_degrees": 6.0,
            "elevation_meters": 100.0,
            "landslide_susceptibility_base": 0.1,
        },
    }

    @pytest.mark.parametrize("profile", ["steep", "moderate", "gentle"])
    def test_zeroed_weather_always_understates_risk(self, profile):
        from app.risk_engine import risk_engine

        terrain = self.TERRAIN[profile]
        dry = risk_engine.evaluate_cell(self.ZEROED, terrain)
        wet = risk_engine.evaluate_cell(self.WET, terrain)

        assert dry["landslide_risk_score"] < wet["landslide_risk_score"]
        assert dry["flood_risk_score"] < wet["flood_risk_score"]

    @pytest.mark.parametrize(
        "profile,real_level,reported_level",
        [
            ("steep", "HIGH", "MODERATE"),
            ("moderate", "HIGH", "MODERATE"),
            ("gentle", "MODERATE", "LOW"),
        ],
    )
    def test_zeroed_weather_reports_a_lower_band(
        self, profile, real_level, reported_level
    ):
        """A HIGH cell is reported MODERATE — the alert threshold is missed."""
        from app.risk_engine import risk_engine

        terrain = self.TERRAIN[profile]

        assert (
            risk_engine.evaluate_cell(self.WET, terrain)["composite_risk_level"]
            == real_level
        )
        assert (
            risk_engine.evaluate_cell(self.ZEROED, terrain)["composite_risk_level"]
            == reported_level
        )
