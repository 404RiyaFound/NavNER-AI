"""Tests for concurrent, deduplicated weather ingestion.

Covers the defect where ``run_risk_evaluation`` awaited one Open-Meteo request per
H3 cell sequentially (~0.7 s each, 14.5 s for 20 cells) while the concurrent batch
helper sat unused. At that rate the 30-minute scheduling interval was exhausted at
roughly 2,500 cells, blocking any grid expansion.
"""

import asyncio

import pytest

from app import weather_service
from app.weather_service import WEATHER_GRID_PRECISION, fetch_weather_for_grid


@pytest.fixture
def fake_fetch(monkeypatch):
    """Replace the upstream call with a counting, artificially-slow stub."""
    calls: list[tuple[float, float]] = []

    async def _fake(lat, lng, *, timeout=15.0):
        calls.append((lat, lng))
        await asyncio.sleep(0.05)  # stand in for a network round trip
        return {
            "rainfall_1h_mm": 1.0,
            "rainfall_24h_mm": 10.0,
            "soil_saturation_pct": 50.0,
            "temperature_c": 20.0,
            "surface_runoff_rate": 1.0,
            "_probe": (lat, lng),
        }

    monkeypatch.setattr(weather_service, "fetch_weather_for_point", _fake)
    return calls


class TestDeduplication:
    @pytest.mark.asyncio
    async def test_nearby_cells_share_one_upstream_request(self, fake_fetch):
        """Cells inside the same ~11 km grid square must not each issue a request."""
        # Eight H3-scale points that all round to the same grid square.
        coords = [(26.140 + i * 0.001, 91.730 + i * 0.001) for i in range(8)]
        results = await fetch_weather_for_grid(coords)

        assert len(results) == 8
        assert len(fake_fetch) == 1, f"expected 1 upstream call, got {len(fake_fetch)}"
        assert all(r["rainfall_24h_mm"] == 10.0 for r in results)

    @pytest.mark.asyncio
    async def test_cells_straddling_a_grid_boundary_fetch_separately(self, fake_fetch):
        """Known limitation of rounding-based grouping, asserted so it stays visible.

        Two cells a few hundred metres apart but on opposite sides of a rounding
        boundary still issue separate requests. Acceptable — the reduction across a
        real grid is still large — but it means dedup efficiency is not uniform.
        """
        coords = [(26.149, 91.73), (26.151, 91.73)]
        await fetch_weather_for_grid(coords)
        assert len(fake_fetch) == 2

    @pytest.mark.asyncio
    async def test_distant_cells_each_fetch(self, fake_fetch):
        coords = [(26.14, 91.73), (25.57, 91.88), (23.83, 91.28)]
        await fetch_weather_for_grid(coords)
        assert len(fake_fetch) == 3

    @pytest.mark.asyncio
    async def test_results_align_with_input_order(self, fake_fetch):
        """Every input index must receive the weather for its own grid square."""
        coords = [(26.14, 91.73), (25.57, 91.88), (26.14, 91.73), (23.83, 91.28)]
        results = await fetch_weather_for_grid(coords)

        assert len(results) == 4
        assert len(fake_fetch) == 3  # the repeated coordinate is deduplicated
        expected = [
            (round(lat, WEATHER_GRID_PRECISION), round(lng, WEATHER_GRID_PRECISION))
            for lat, lng in coords
        ]
        assert [r["_probe"] for r in results] == expected

    @pytest.mark.asyncio
    async def test_empty_input(self, fake_fetch):
        assert await fetch_weather_for_grid([]) == []
        assert len(fake_fetch) == 0


class TestConcurrency:
    @pytest.mark.asyncio
    async def test_distinct_squares_are_fetched_concurrently(self, fake_fetch):
        """20 distinct squares must not take 20x a single request's latency."""
        coords = [(20.0 + i * 0.5, 90.0 + i * 0.5) for i in range(20)]

        started = asyncio.get_event_loop().time()
        results = await fetch_weather_for_grid(coords)
        elapsed = asyncio.get_event_loop().time() - started

        assert len(results) == 20
        assert len(fake_fetch) == 20
        # Sequential would be 20 x 0.05s = 1.0s. With a concurrency cap of 8 this
        # should need ~3 waves (~0.15s). Allow generous headroom for slow CI.
        assert elapsed < 0.6, f"appears sequential: {elapsed:.2f}s for 20 requests"

    @pytest.mark.asyncio
    async def test_concurrency_is_bounded(self, monkeypatch):
        """Requests must be capped so a large grid does not flood the upstream API."""
        in_flight = 0
        peak = 0

        async def _fake(lat, lng, *, timeout=15.0):
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0.02)
            in_flight -= 1
            return {"rainfall_1h_mm": 0.0}

        monkeypatch.setattr(weather_service, "fetch_weather_for_point", _fake)
        coords = [(20.0 + i * 0.5, 90.0 + i * 0.5) for i in range(40)]
        await fetch_weather_for_grid(coords)

        assert peak <= weather_service.MAX_CONCURRENT_REQUESTS, (
            f"peak concurrency {peak} exceeded cap "
            f"{weather_service.MAX_CONCURRENT_REQUESTS}"
        )


class TestRetryPolicy:
    @pytest.mark.asyncio
    async def test_rate_limit_is_retried_then_succeeds(self, monkeypatch):
        """HTTP 429 must be retried rather than degrading straight to zeros."""
        import httpx

        attempts = {"n": 0}

        class _Resp:
            def __init__(self, status):
                self.status_code = status
                self.headers = {"Retry-After": "0"}

            def raise_for_status(self):
                raise httpx.HTTPStatusError("429", request=None, response=self)

            def json(self):
                return {}

        async def _get(self, url, params=None):
            attempts["n"] += 1
            if attempts["n"] < 3:
                return _Resp(429)
            ok = _Resp(200)
            ok.raise_for_status = lambda: None
            ok.json = lambda: {
                "current": {"precipitation": 5.0, "soil_moisture_0_to_7cm": 0.25,
                            "temperature_2m": 21.0},
                "hourly": {"precipitation": [1.0] * 24},
            }
            return ok

        monkeypatch.setattr(httpx.AsyncClient, "get", _get)
        monkeypatch.setattr(weather_service, "BACKOFF_BASE_SECONDS", 0.0)

        result = await weather_service.fetch_weather_for_point(26.14, 91.73)

        assert attempts["n"] == 3, "should have retried twice before succeeding"
        assert result["rainfall_1h_mm"] == 5.0
        assert result["rainfall_24h_mm"] == 24.0
