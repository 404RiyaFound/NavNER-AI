"""AI Risk Assessment Engine — Stage 2 ML inference for NER hazard prediction.

Uses a RandomForestClassifier trained on synthetic NER terrain data to compute
landslide and flood risk scores per H3 grid cell.  The model is self-contained:
no external model file is needed — synthetic training data is generated and fit
at module load time.
"""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


# ── Risk thresholds (from PRD §4C) ────────────────────────────────────────────
RISK_THRESHOLDS = {
    "LOW": (0.0, 0.35),
    "MODERATE": (0.35, 0.65),
    "HIGH": (0.65, 0.85),
    "CRITICAL": (0.85, 1.01),
}

# Action mapping per risk level
ACTION_MAP = {
    "LOW": "NORMAL_TRANSIT",
    "MODERATE": "SPEED_RESTRICTION",
    "HIGH": "REROUTE_RECOMMENDED",
    "CRITICAL": "IMMEDIATE_REROUTE",
}


def _classify_risk(score: float) -> str:
    """Map a 0-1 composite score to a risk level string."""
    for level, (lo, hi) in RISK_THRESHOLDS.items():
        if lo <= score < hi:
            return level
    return "CRITICAL"


def _generate_synthetic_training_data(n_samples: int = 2000) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Generate realistic synthetic training data calibrated for NER terrain.

    Features (7):
        0: rainfall_1h_mm          (0-80)
        1: rainfall_24h_mm         (0-300)
        2: soil_saturation_pct     (0-100)
        3: avg_slope_degrees       (0-60)
        4: elevation_meters        (0-3500)
        5: active_incidents_5km    (0-10)
        6: landslide_susceptibility_base (0-1)

    Returns:
        X: feature matrix
        y_landslide: landslide risk scores (0-1)
        y_flood: flood risk scores (0-1)
    """
    rng = np.random.RandomState(42)

    # Feature ranges calibrated to NER
    rainfall_1h = rng.uniform(0, 80, n_samples)
    rainfall_24h = rng.uniform(0, 300, n_samples)
    soil_sat = rng.uniform(0, 100, n_samples)
    slope = rng.uniform(0, 60, n_samples)
    elevation = rng.uniform(50, 3500, n_samples)
    incidents_5km = rng.randint(0, 11, n_samples).astype(float)
    base_susceptibility = rng.uniform(0, 1, n_samples)

    X = np.column_stack([
        rainfall_1h, rainfall_24h, soil_sat, slope,
        elevation, incidents_5km, base_susceptibility,
    ])

    # Landslide risk — heavily influenced by slope, rainfall, soil saturation
    landslide_raw = (
        0.30 * (slope / 60)
        + 0.28 * (rainfall_24h / 300)
        + 0.22 * (soil_sat / 100)
        + 0.12 * base_susceptibility
        + 0.05 * (elevation / 3500)
        + 0.03 * (incidents_5km / 10)
    )
    # Power-law stretch: pushes high raw scores towards 1.0
    landslide_raw = np.power(landslide_raw, 0.65)
    noise_l = rng.normal(0, 0.04, n_samples)
    y_landslide = np.clip(landslide_raw + noise_l, 0, 1)

    # Flood risk — heavily influenced by rainfall intensity and flat terrain
    safe_slope = np.maximum(slope, 1.0)
    flood_raw = (
        0.38 * (rainfall_1h / 80)
        + 0.28 * (rainfall_24h / 300)
        + 0.18 * (1.0 / safe_slope)  # flatter → more flood risk
        + 0.10 * (soil_sat / 100)
        + 0.06 * (incidents_5km / 10)
    )
    flood_raw = np.power(flood_raw, 0.65)
    noise_f = rng.normal(0, 0.04, n_samples)
    y_flood = np.clip(flood_raw + noise_f, 0, 1)

    return X, y_landslide, y_flood


class RiskAssessmentEngine:
    """ML engine for computing per-cell hazard risk scores.

    Exposes a single public method ``evaluate_cell`` that accepts weather +
    terrain dicts and returns a complete risk assessment dict.
    """

    def __init__(self) -> None:
        self._landslide_model: Pipeline | None = None
        self._flood_model: Pipeline | None = None
        self._is_fitted = False
        self._fit_models()

    # ── Private ────────────────────────────────────────────────────────────

    def _fit_models(self) -> None:
        """Train models on synthetic NER data at init time."""
        X, y_landslide, y_flood = _generate_synthetic_training_data()

        self._landslide_model = Pipeline([
            ("scaler", StandardScaler()),
            ("rf", RandomForestRegressor(
                n_estimators=80,
                max_depth=10,
                random_state=42,
                n_jobs=-1,
            )),
        ])
        self._landslide_model.fit(X, y_landslide)

        self._flood_model = Pipeline([
            ("scaler", StandardScaler()),
            ("rf", RandomForestRegressor(
                n_estimators=80,
                max_depth=10,
                random_state=42,
                n_jobs=-1,
            )),
        ])
        self._flood_model.fit(X, y_flood)

        self._is_fitted = True

    def _determine_primary_factor(
        self,
        weather: dict,
        terrain: dict,
        landslide_score: float,
        flood_score: float,
    ) -> str:
        """Identify the primary contributing factor for the risk assessment."""
        slope = terrain.get("avg_slope_degrees", 0)
        rainfall_24h = weather.get("rainfall_24h_mm", 0)
        rainfall_1h = weather.get("rainfall_1h_mm", 0)
        soil_sat = weather.get("soil_saturation_pct", 0)

        if landslide_score >= flood_score:
            # Landslide-dominant
            if slope >= 30:
                return f"Heavy precipitation on steep slope ({slope:.0f}°)"
            if rainfall_24h >= 100:
                return f"Prolonged rainfall ({rainfall_24h:.0f}mm/24h) on unstable terrain"
            if soil_sat >= 80:
                return f"Critically saturated soil ({soil_sat:.0f}%) with slope {slope:.0f}°"
            return f"Elevated landslide conditions (slope {slope:.0f}°, rain {rainfall_24h:.0f}mm)"
        else:
            # Flood-dominant
            if rainfall_1h >= 40:
                return f"Flash flood risk — extreme rainfall ({rainfall_1h:.0f}mm/hr)"
            if rainfall_24h >= 150:
                return f"Sustained flooding — {rainfall_24h:.0f}mm accumulated rainfall"
            return f"Waterlogging risk (rainfall {rainfall_1h:.0f}mm/hr, low drainage)"

    # ── Public API ─────────────────────────────────────────────────────────

    def evaluate_cell(
        self,
        weather_data: dict,
        terrain_data: dict,
    ) -> dict:
        """Compute risk scores for a single H3 cell.

        Parameters
        ----------
        weather_data : dict
            Keys: rainfall_1h_mm, rainfall_24h_mm, soil_saturation_pct,
                  temperature_c, surface_runoff_rate
        terrain_data : dict
            Keys: avg_slope_degrees, elevation_meters,
                  landslide_susceptibility_base

        Returns
        -------
        dict with keys: landslide_risk_score, flood_risk_score,
            composite_risk_level, predicted_blockage_probability,
            primary_contributing_factor, action_required, composite_score
        """
        if not self._is_fitted:
            raise RuntimeError("Risk engine models have not been trained.")

        # Build feature vector (same order as training)
        features = np.array([[
            weather_data.get("rainfall_1h_mm", 0),
            weather_data.get("rainfall_24h_mm", 0),
            weather_data.get("soil_saturation_pct", 0),
            terrain_data.get("avg_slope_degrees", 0),
            terrain_data.get("elevation_meters", 0),
            0,  # active_incidents_5km — default to 0 (could be enriched later)
            terrain_data.get("landslide_susceptibility_base", 0),
        ]])

        landslide_score = float(np.clip(self._landslide_model.predict(features)[0], 0, 1))
        flood_score = float(np.clip(self._flood_model.predict(features)[0], 0, 1))

        # Composite = weighted combination emphasising the dominant risk
        composite = max(landslide_score, flood_score) * 0.8 + min(landslide_score, flood_score) * 0.2
        composite = float(np.clip(composite, 0, 1))

        risk_level = _classify_risk(composite)
        action = ACTION_MAP[risk_level]

        # Blockage probability is a calibrated function of composite
        blockage_prob = float(np.clip(composite * 1.1 - 0.05, 0, 1))

        primary_factor = self._determine_primary_factor(
            weather_data, terrain_data, landslide_score, flood_score,
        )

        return {
            "landslide_risk_score": round(landslide_score, 4),
            "flood_risk_score": round(flood_score, 4),
            "composite_score": round(composite, 4),
            "composite_risk_level": risk_level,
            "predicted_blockage_probability": round(blockage_prob, 4),
            "primary_contributing_factor": primary_factor,
            "action_required": action,
        }

    def evaluate_batch(
        self,
        cells: list[dict],
    ) -> list[dict]:
        """Evaluate multiple cells at once for efficiency.

        Parameters
        ----------
        cells : list of dict
            Each dict must have 'weather_data' and 'terrain_data' keys.

        Returns
        -------
        list of risk assessment dicts (same format as evaluate_cell)
        """
        return [
            self.evaluate_cell(c["weather_data"], c["terrain_data"])
            for c in cells
        ]


# Module-level singleton — trained once at import
risk_engine = RiskAssessmentEngine()
