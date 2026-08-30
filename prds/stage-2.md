### **Stage 2 PRD: AI Predictive Disruption Engine, Meteorological Ingestion & Risk Scoring**

**Objective:** Build and integrate the predictive intelligence layer that forecasts weather-induced route disruptions (landslides, flash floods, waterlogging) across the North Eastern Region (NER). This engine dynamically computes segment-level risk indices along transport corridors and exposes real-time risk heatmaps to the GIS layer.

---

### **1. System Architecture & Processing Pipeline (Stage 2)**

```text
+-----------------------+     +-----------------------+     +------------------------+
|  IMD Weather API /    |     |  ISRO Bhuvan / DEM    |     |  Stage 1 Incident      |
|  Open-Meteo Telemetry |     |  Topography Data      |     |  Verified Field Logs   |
+-----------+-----------+     +-----------+-----------+     +-----------+------------+
            |                             |                             |
            +--------------------+        |        +--------------------+
                                 |        |        |
                                 v        v        v
                      +----------------------------------+
                      |   Data Normalization & Spatial   |
                      |   Alignment (Uber H3 Indexing)   |
                      +-----------------+----------------+
                                        |
                                        v
                      +----------------------------------+
                      |  AI Risk Assessment Model Engine |
                      |  (RandomForest / XGBoost / EBM)  |
                      +-----------------+----------------+
                                        |
                                        v
                      +----------------------------------+
                      | Segment Risk Scores & Hazard GeoJSON |
                      +-----------------+----------------+
                                        |
                   +--------------------+--------------------+
                   v                                         v
+------------------------------------+    +------------------------------------+
| Dynamic Heatmap Overlay Service    |    |  Rerouting Trigger Engine          |
| (GeoJSON / Vector Tile to Web UI)  |    |  (Feeds into Stage 3 Graph Router) |
+------------------------------------+    +------------------------------------+

```

---

### **2. Data Ingestion Pipeline & Geospatial Partitioning**

To make continuous predictions over complex terrain, partition the entire NER geographic zone into a discrete global grid using **Uber H3 (Resolution 7 ~ 1.22 km² hexagons)** or **Resolution 8 (~0.46 km² hexagons)**.

#### **A. External Data Feeds**

1. **Meteorological Stream:**
* **Source:** Open-Meteo / IMD Gridded Weather API.
* **Telemetry Captured:** Precipitation rate ($\text{mm/hr}$), accumulated 24-hour rainfall ($\text{mm}$), soil moisture index ($0\text{--}100\%$), wind gust speed ($\text{km/h}$).
* **Polling Cadence:** Automated cron runner executing every 30 minutes.


2. **Topographical / Terrain Stream:**
* **Source:** SRTM / ISRO Bhuvan Digital Elevation Models (DEM).
* **Features Derived:** Slope gradient (degrees), elevation profile (meters), geological fault proximity index.


3. **Historical Disruption Baseline:**
* Ground-truth records of prior landslide and flash-flood coordinates across Assam, Meghalaya, Sikkim, Arunachal Pradesh, Mizoram, Nagaland, and Tripura.



---

### **3. Database Schema Extensions (PostGIS + TimescaleDB)**

```sql
-- 1. H3 Spatial Hexagon Grid Cache
CREATE TABLE spatial_grid_cells (
    h3_index VARCHAR(15) PRIMARY KEY,
    geom GEOMETRY(Polygon, 4326) NOT NULL,
    state VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    avg_slope_degrees FLOAT NOT NULL,
    elevation_meters FLOAT NOT NULL,
    landslide_susceptibility_base FLOAT DEFAULT 0.0 -- Base geologic risk (0.0 to 1.0)
);
CREATE INDEX idx_spatial_grid_geom ON spatial_grid_cells USING GIST(geom);

-- 2. Environmental Real-Time Telemetry
CREATE TABLE weather_telemetry (
    id BIGSERIAL PRIMARY KEY,
    h3_index VARCHAR(15) REFERENCES spatial_grid_cells(h3_index),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rainfall_1h_mm FLOAT NOT NULL,
    rainfall_24h_mm FLOAT NOT NULL,
    soil_saturation_pct FLOAT NOT NULL,
    temperature_c FLOAT,
    surface_runoff_rate FLOAT
);
CREATE INDEX idx_weather_h3_time ON weather_telemetry(h3_index, timestamp DESC);

-- 3. Segment Predictive Disruption Scores
CREATE TABLE segment_risk_assessments (
    h3_index VARCHAR(15) PRIMARY KEY REFERENCES spatial_grid_cells(h3_index),
    last_evaluated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    landslide_risk_score FLOAT NOT NULL,  -- Scale 0.00 to 1.00
    flood_risk_score FLOAT NOT NULL,      -- Scale 0.00 to 1.00
    composite_risk_level VARCHAR(20) NOT NULL, -- 'LOW', 'MODERATE', 'HIGH', 'CRITICAL'
    predicted_blockage_probability FLOAT NOT NULL,
    primary_contributing_factor VARCHAR(100)
);
CREATE INDEX idx_risk_level ON segment_risk_assessments(composite_risk_level);

```

---

### **4. AI/ML Risk Scoring Model Engine**

#### **A. Model Selection & Rationale**

* **Model Class:** **XGBoost Classifier / Regressor** or **Ensemble Random Forest**.
* **Reason:** Handles non-linear relationships between slope steepness, continuous rainfall accumulation, and soil saturation with minimal latency ($< 15\text{ ms}$ inference time per cell batch).

#### **B. Feature Matrix Definition ($X$)**

$$\text{Feature Vector } \mathbf{x}_i = \begin{bmatrix} \text{rainfall\_1h} \\ \text{rainfall\_24h\_cumulative} \\ \text{soil\_saturation\_pct} \\ \text{avg\_slope\_degrees} \\ \text{elevation\_meters} \\ \text{active\_field\_incidents\_count\_5km} \\ \text{landslide\_susceptibility\_base} \end{bmatrix}$$

#### **C. Risk Scoring Logic Formulation**

1. **Landslide Risk Score ($S_{\text{landslide}}$):**

$$S_{\text{landslide}} = \sigma\Big(w_1 \cdot \text{slope} + w_2 \cdot \text{rainfall\_24h} + w_3 \cdot \text{soil\_saturation} + w_4 \cdot \text{base\_susceptibility}\Big)$$


2. **Flash Flood Risk Score ($S_{\text{flood}}$):**

$$S_{\text{flood}} = \sigma\Big(u_1 \cdot \text{rainfall\_1h} + u_2 \cdot \text{surface\_runoff} + u_3 \cdot (1 / \text{slope})\Big)$$


3. **Composite Risk Classification:**
* **LOW:** $\text{Composite} < 0.35$ (Green: Normal transit)
* **MODERATE:** $0.35 \le \text{Composite} < 0.65$ (Yellow: Caution / speed restriction)
* **HIGH:** $0.65 \le \text{Composite} < 0.85$ (Orange: Reroute recommendation alert)
* **CRITICAL:** $\text{Composite} \ge 0.85$ (Red: Automated roadblock trigger & mandatory reroute)



---

### **5. Backend Service Contracts & API Specs (FastAPI)**

#### **Endpoint 1: Fetch Hazard Heatmap Overlay**

* **Route:** `GET /api/v1/analytics/hazard-map`
* **Query Parameters:** `district` (optional), `min_risk` (e.g., `0.5`)
* **Response:**

```json
{
  "type": "FeatureCollection",
  "generated_at": "2026-08-31T00:30:00Z",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[91.736, 26.144], [91.745, 26.150], [91.755, 26.140], [91.736, 26.144]]]
      },
      "properties": {
        "h3_index": "8860144213fffff",
        "district": "East Khasi Hills",
        "risk_level": "CRITICAL",
        "landslide_prob": 0.91,
        "flood_prob": 0.34,
        "primary_threat": "Heavy precipitation on steep slope (38°)",
        "action_required": "IMMEDIATE_REROUTE"
      }
    }
  ]
}

```

#### **Endpoint 2: Trigger Batch Risk Inference Pipeline**

* **Route:** `POST /api/v1/analytics/evaluate-grid`
* **Payload:** Optional list of H3 cell IDs; if empty, evaluates all active corridor buffers.
* **Process:** Fetches latest weather $\rightarrow$ constructs feature vectors $\rightarrow$ runs ML batch inference $\rightarrow$ updates `segment_risk_assessments` $\rightarrow$ broadcasts websocket alert to connected command center clients.

---

### **6. Web Dashboard UI Integration (Hazard Map Layers)**

* **Mapbox GeoJSON Source:** Dynamic vector/polygon fill layer binding `fill-color` to `risk_level` (Red: `#E53935`, Orange: `#FB8C00`, Yellow: `#FDD835`, Green: `#43A047`).
* **Interactive Tooltip:** Clicking any H3 grid polygon shows:
* Rainfall rate ($\text{mm/hr}$)
* Ground slope
* Model confidence score
* Estimated time to potential road disruption.


* **Emergency Alert Bar:** Pinned banner at the top of the dashboard showing active high-risk corridor segments.

---

### **7. Code-Generation Prompts for LLM Implementation**

#### **Prompt A: Fast Python AI Prediction Service & Feature Ingestion**

> **System Prompt for Backend Engineer LLM:**
> Write a complete FastAPI module in Python for an AI Hazard Prediction Service for the North Eastern Region.
> **Requirements:**
> 1. Use `scikit-learn` to define an inference pipeline using a pre-trained `RandomForestClassifier` (or mock-trained estimator with realistic synthetic defaults for NER parameters).
> 2. Implement a service class `RiskAssessmentEngine` with method `evaluate_cell(weather_data: dict, terrain_data: dict) -> dict` returning `landslide_risk_score`, `flood_risk_score`, and `composite_risk_level`.
> 3. Implement an endpoint `GET /api/v1/analytics/hazard-map` that queries PostGIS polygons from `spatial_grid_cells` joined with `segment_risk_assessments` and returns a valid GeoJSON `FeatureCollection`.
> 4. Include a scheduled background task using `APScheduler` or FastAPI `BackgroundTasks` that fetches weather data from the Open-Meteo REST API for coordinates `(26.14, 91.73)` (Guwahati corridor) and updates the risk table.
> 5. Ensure all code is typed with Pydantic v2 schemas and fully async.
> 
> 

#### **Prompt B: Mapbox Risk Heatmap Overlay Component**

> **System Prompt for Frontend Engineer LLM:**
> Build a React component (`HazardMapOverlay.jsx`) using `react-map-gl` (Mapbox GL JS).
> **Requirements:**
> 1. Fetch the GeoJSON payload from `/api/v1/analytics/hazard-map`.
> 2. Add a `Source` and `Layer` of type `fill` and `line` that colors polygons based on `risk_level` (`CRITICAL` -> `#E53935`, `HIGH` -> `#FB8C00`, `MODERATE` -> `#FDD835`).
> 3. Implement hover and click interactions: on click, render a Mapbox `Popup` showing the H3 cell's `primary_threat`, slope degrees, and predicted blockage probability.
> 4. Add a toggle switch in the UI: "Toggle AI Disruption Heatmap" and a slider to filter by Minimum Risk Threshold ($0\%\text{--}100\%$).
> 
>