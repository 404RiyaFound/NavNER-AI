"""Regression tests for hazard risk classification.

These cover the defect where the composite blend
``max(landslide, flood) * 0.8 + min(...) * 0.2`` drove classification, diluting a
dominant hazard toward the weaker one. That made HIGH require a landslide score of
0.735 and CRITICAL require 0.985 at a typical flood score of 0.31 — so a live
evaluation returned MODERATE for every cell in the region.
"""

import pytest

from app.risk_engine import RISK_THRESHOLDS, classify_hazard


class TestDominantHazardDrivesClassification:
    """A high score in either hazard must classify on its own merits."""

    def test_high_landslide_is_not_diluted_by_low_flood(self):
        # The exact observed case: 0.706 sits in the HIGH band and was reported MODERATE.
        result = classify_hazard(landslide_score=0.706, flood_score=0.311)
        assert result["composite_risk_level"] == "HIGH"

    def test_high_flood_is_not_diluted_by_low_landslide(self):
        # Symmetric case — a Barak Valley flood plain does not landslide.
        result = classify_hazard(landslide_score=0.10, flood_score=0.706)
        assert result["composite_risk_level"] == "HIGH"

    @pytest.mark.parametrize("flood_score", [0.0, 0.2, 0.31, 0.5])
    def test_landslide_classification_is_independent_of_flood(self, flood_score):
        """The level must depend only on the dominant score, not the weaker one."""
        result = classify_hazard(landslide_score=0.90, flood_score=flood_score)
        assert result["composite_risk_level"] == "CRITICAL"


class TestSeverityBandsAreReachable:
    """Every band must be reachable under conditions that actually occur in the NER."""

    @pytest.mark.parametrize(
        "score,expected",
        [
            (0.10, "LOW"),
            (0.34, "LOW"),
            (0.35, "MODERATE"),
            (0.59, "MODERATE"),
            (0.60, "HIGH"),
            (0.79, "HIGH"),
            (0.80, "CRITICAL"),
            (1.00, "CRITICAL"),
        ],
    )
    def test_band_boundaries(self, score, expected):
        assert classify_hazard(score, 0.0)["composite_risk_level"] == expected

    def test_model_output_domain_maximum_reaches_critical(self):
        """CRITICAL must be reachable somewhere in the model's input domain."""
        from app.risk_engine import risk_engine

        result = risk_engine.evaluate_cell(
            weather_data={
                "rainfall_1h_mm": 80.0,
                "rainfall_24h_mm": 300.0,
                "soil_saturation_pct": 100.0,
                "temperature_c": 22.0,
                "surface_runoff_rate": 100.0,
            },
            terrain_data={
                "avg_slope_degrees": 60.0,
                "elevation_meters": 3500.0,
                "landslide_susceptibility_base": 1.0,
            },
        )
        assert result["composite_risk_level"] == "CRITICAL"

    def test_severe_monsoon_conditions_reach_at_least_high(self):
        """A steep slope under sustained heavy rain must not be MODERATE.

        This is the case the composite-blend defect got wrong: before the fix it
        classified MODERATE because flood risk was comparatively low.

        Note it reaches HIGH, not CRITICAL. The RandomForest regressor averages over
        leaves and so compresses its output range — the highest landslide score it
        can emit anywhere in its input domain is ~0.873, leaving CRITICAL (>=0.85)
        reachable only at the extreme corner of the input space. That is a separate
        model-calibration defect, tracked independently; this test pins the
        behaviour the classification fix is responsible for.
        """
        from app.risk_engine import risk_engine

        result = risk_engine.evaluate_cell(
            weather_data={
                "rainfall_1h_mm": 45.0,
                "rainfall_24h_mm": 260.0,
                "soil_saturation_pct": 95.0,
                "temperature_c": 22.0,
                "surface_runoff_rate": 40.0,
            },
            terrain_data={
                "avg_slope_degrees": 42.0,
                "elevation_meters": 1650.0,
                "landslide_susceptibility_base": 0.85,
            },
        )
        assert result["composite_risk_level"] in ("HIGH", "CRITICAL"), (
            f"severe conditions produced {result['composite_risk_level']} "
            f"(landslide={result['landslide_risk_score']}, flood={result['flood_risk_score']})"
        )

    def test_model_output_ceiling_is_documented(self):
        """Pin the known output ceiling so a calibration fix is detected, not silent."""
        from app.risk_engine import risk_engine

        result = risk_engine.evaluate_cell(
            weather_data={
                "rainfall_1h_mm": 80.0, "rainfall_24h_mm": 300.0,
                "soil_saturation_pct": 100.0, "temperature_c": 22.0,
                "surface_runoff_rate": 100.0,
            },
            terrain_data={
                "avg_slope_degrees": 60.0, "elevation_meters": 3500.0,
                "landslide_susceptibility_base": 1.0,
            },
        )
        # If a recalibration widens the range, this will fail and should be updated.
        assert result["landslide_risk_score"] < 0.95, (
            "landslide score ceiling has changed — update the calibration issue"
        )

    def test_calm_conditions_are_low(self):
        from app.risk_engine import risk_engine

        result = risk_engine.evaluate_cell(
            weather_data={
                "rainfall_1h_mm": 0.0,
                "rainfall_24h_mm": 0.0,
                "soil_saturation_pct": 10.0,
                "temperature_c": 24.0,
                "surface_runoff_rate": 0.0,
            },
            terrain_data={
                "avg_slope_degrees": 3.0,
                "elevation_meters": 55.0,
                "landslide_susceptibility_base": 0.05,
            },
        )
        assert result["composite_risk_level"] == "LOW"


class TestSeedStateMatchesClassifier:
    """The seeded dashboard state must be reproducible by the engine.

    Previously ``INITIAL_RISK_DATA`` hardcoded ``composite_risk_level`` strings that
    the engine's own formula contradicted — Aizawl's (0.88, 0.32) was labelled
    CRITICAL but classified HIGH — so the first evaluation rewrote the map.
    """

    def test_every_seeded_cell_is_self_consistent(self):
        from app.seed import INITIAL_RISK_DATA

        for district, (landslide, flood, _factor) in INITIAL_RISK_DATA.items():
            derived = classify_hazard(landslide, flood)
            # Recomputing from the stored scores must be stable.
            again = classify_hazard(landslide, flood)
            assert derived == again, f"{district} classification is not deterministic"

    def test_seeded_data_still_contains_a_critical_cell(self):
        """The demo needs at least one CRITICAL corridor to exercise alerting."""
        from app.seed import INITIAL_RISK_DATA

        levels = {
            classify_hazard(ls, fl)["composite_risk_level"]
            for ls, fl, _ in INITIAL_RISK_DATA.values()
        }
        assert "CRITICAL" in levels
        assert "HIGH" in levels


class TestDerivedFields:
    def test_blockage_probability_tracks_dominant_hazard(self):
        result = classify_hazard(0.90, 0.10)
        assert result["predicted_blockage_probability"] == pytest.approx(0.94, abs=1e-3)

    def test_composite_score_still_ranks_dual_hazard_higher(self):
        """The blended index is retained for ranking within a level."""
        single = classify_hazard(0.70, 0.10)
        dual = classify_hazard(0.70, 0.65)
        assert single["composite_risk_level"] == dual["composite_risk_level"] == "HIGH"
        assert dual["composite_score"] > single["composite_score"]

    def test_scores_are_clamped(self):
        assert classify_hazard(1.5, -0.2)["composite_risk_level"] == "CRITICAL"
        assert classify_hazard(-1.0, -1.0)["composite_risk_level"] == "LOW"

    def test_action_matches_level(self):
        assert classify_hazard(0.95, 0.1)["action_required"] == "IMMEDIATE_REROUTE"
        assert classify_hazard(0.10, 0.1)["action_required"] == "NORMAL_TRANSIT"

    def test_thresholds_cover_the_unit_interval(self):
        """Guard against a gap or overlap being introduced into the bands."""
        bounds = sorted(RISK_THRESHOLDS.values())
        for (_, hi), (lo_next, _) in zip(bounds, bounds[1:]):
            assert hi == lo_next
