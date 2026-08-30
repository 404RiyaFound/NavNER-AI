### **Stage 3 PRD: Dynamic Graph-Based Rerouting Engine & Fleet Optimization**

**Objective:** Build and integrate the dynamic routing and fleet tracking engine. When road blockages (from Stage 1 field logs) or critical hazard zones (from Stage 2 predictive risk scores) are detected, the system automatically recalculates optimal alternate paths for supply vehicles, updates ETAs, and issues instant reroute advisories to fleet operators and drivers.

---

### **1. System Architecture & Routing Flow (Stage 3)**

```text
+------------------------------+     +-------------------------------+
|  Stage 1 Incident Layer      |     |  Stage 2 AI Hazard Predictions |
|  (Confirmed Road Closures)   |     |  (H3 High/Critical Risk Cells) |
+--------------+---------------+     +---------------+---------------+
               |                                     |
               +------------------+  +---------------+
                                  |  |
                                  v  v
                      +-----------------------------+
                      | Dynamic Road Weight Engine  |
                      | (Penalty / Edge Exclusions) |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      | Graph Routing Engine (OSRM/ |
                      | NetworkX / pgRouting)       |
                      +--------------+--------------+
                                     |
                    +----------------+----------------+
                    |                                 |
                    v                                 v
    +-------------------------------+   +-------------------------------+
    | Fleet Dispatcher / Web UI     |   | Driver Mobile Advisory / SMS  |
    | (Path Overlay & Step-by-Step) |   | (Low-Bandwidth Route Updates) |
    +-------------------------------+   +-------------------------------+

```

---

### **2. Road Network Representation & Graph Modeling**

The North Eastern Region road network is modeled as a directed weighted graph $G = (V, E, W)$, where:

* **$V$ (Vertices/Nodes):** Intersections, checkpoints, supply depots, district headquarters, and terrain bottlenecks.
* **$E$ (Edges/Segments):** Road links connecting nodes (National Highways, State Highways, and Rural Roads).
* **$W$ (Dynamic Weights/Costs):** The dynamic travel cost of traversing edge $e \in E$, computed using physical distance, baseline transit time, gradient, and risk penalties.

#### **Dynamic Cost Function Formulation**

For each edge $e = (u, v)$ with base traversal time $T_{\text{base}}(e)$, the routing cost $C(e)$ is dynamically updated:

$$C(e) = \begin{cases}  \infty, & \text{if edge has confirmed blockage (Incident Status = 'BLOCKED')} \\ T_{\text{base}}(e) \cdot \Big(1 + \alpha \cdot R_{\text{hazard}}(e) + \beta \cdot G_{\text{gradient}}(e)\Big), & \text{otherwise} \end{cases}$$

Where:

* $R_{\text{hazard}}(e) \in [0, 1]$: Maximum composite hazard risk score (from intersecting Stage 2 H3 cells).
* $G_{\text{gradient}}(e) \in [0, 1]$: Terrain difficulty factor derived from road slope.
* $\alpha, \beta$: Tuning hyper-parameters (e.g., $\alpha = 3.0$ heavily penalizes high landslide risk corridors, routing traffic through safer alternatives even if physically longer).

---

### **3. Database Schema Extensions (PostGIS + Routing Tables)**

```sql
-- 1. Road Network Topo-Graph Edges
CREATE TABLE road_network_edges (
    edge_id BIGSERIAL PRIMARY KEY,
    source_node BIGINT NOT NULL,
    target_node BIGINT NOT NULL,
    road_name VARCHAR(100),
    road_class VARCHAR(50), -- 'NH', 'SH', 'MDR', 'RURAL'
    length_km FLOAT NOT NULL,
    base_speed_kmh FLOAT NOT NULL,
    base_duration_min FLOAT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    current_status VARCHAR(20) DEFAULT 'CLEAR', -- 'CLEAR', 'RESTRICTED', 'BLOCKED'
    current_hazard_penalty FLOAT DEFAULT 0.0,
    geom GEOMETRY(LineString, 4326) NOT NULL
);
CREATE INDEX idx_road_geom ON road_network_edges USING GIST(geom);
CREATE INDEX idx_road_nodes ON road_network_edges(source_node, target_node);

-- 2. Vehicle Active Missions & Route Assignments
CREATE TABLE vehicle_trips (
    trip_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id BIGINT REFERENCES vehicles(id),
    origin_name VARCHAR(100) NOT NULL,
    origin_coords GEOMETRY(Point, 4326) NOT NULL,
    dest_name VARCHAR(100) NOT NULL,
    dest_coords GEOMETRY(Point, 4326) NOT NULL,
    commodity_type VARCHAR(50) NOT NULL, -- 'MEDICINE', 'FOOD_GRAINS', 'FUEL', 'GENERAL'
    priority_level VARCHAR(20) DEFAULT 'STANDARD', -- 'EMERGENCY', 'HIGH_PRIORITY', 'STANDARD'
    status VARCHAR(30) DEFAULT 'IN_TRANSIT', -- 'PENDING', 'IN_TRANSIT', 'REROUTED', 'COMPLETED'
    original_route_geom GEOMETRY(LineString, 4326),
    current_active_route GEOMETRY(LineString, 4326),
    estimated_arrival TIMESTAMPTZ,
    last_rerouted_at TIMESTAMPTZ
);
CREATE INDEX idx_vehicle_trips_active ON vehicle_trips(vehicle_id, status);

-- 3. Rerouting Audit & Event History
CREATE TABLE reroute_logs (
    log_id BIGSERIAL PRIMARY KEY,
    trip_id UUID REFERENCES vehicle_trips(trip_id),
    trigger_reason VARCHAR(100) NOT NULL, -- 'CONFIRMED_LANDSLIDE', 'PREDICTED_FLOOD', 'MANUAL_OVERRIDE'
    old_eta TIMESTAMPTZ,
    new_eta TIMESTAMPTZ,
    delay_variance_minutes INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

```

---

### **4. Dynamic Rerouting Engine Logic & Algorithm**

#### **A. Routing Algorithm Engine**

* **Primary Router:** Custom Python `NetworkX` graph engine with Dijkstra / bidirectional A* algorithm for custom dynamic penalty adjustments, or an embedded **OSRM (Open Source Routing Machine)** instance with custom Lua weight scripts.
* **Execution Trigger:** An event listener listening to:
1. Incident creation in Stage 1 with severity `CRITICAL` or `BLOCKED`.
2. Batch updates in Stage 2 generating `composite_risk_level = 'CRITICAL'`.



#### **B. Reroute Evaluation Workflow**

1. **Intersection Query:** Check all active `vehicle_trips` whose `current_active_route` intersects the bounding buffer of the new hazard/incident point using PostGIS `ST_DWithin()`.
2. **Edge Cost Penalty Assignment:** Temporarily disable affected edges ($C(e) = \infty$) or apply dynamic hazard scaling.
3. **Graph Traversal:** Compute the alternative path from the vehicle's last known coordinates (`current_lat`, `current_lng`) to destination coordinates.
4. **Impact Assessment:** Calculate $\Delta \text{Distance}$ and $\Delta \text{ETA}$.
5. **State Update & Push:** Save new path to `vehicle_trips.current_active_route`, insert an audit record into `reroute_logs`, and dispatch instant notification.

---

### **5. Backend API Endpoints & Notification Specs (FastAPI)**

#### **Endpoint 1: Calculate / Recalculate Route**

* **Route:** `POST /api/v1/routing/calculate-route`
* **Payload:**

```json
{
  "trip_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "avoid_hazards": true,
  "max_hazard_tolerance": 0.60
}

```

* **Response:**

```json
{
  "status": "REROUTED_SUCCESSFULLY",
  "total_distance_km": 142.6,
  "estimated_duration_min": 245,
  "previous_duration_min": 190,
  "delay_minutes": 55,
  "avoided_hazards_count": 2,
  "route_geojson": {
    "type": "LineString",
    "coordinates": [
      [91.736, 26.144],
      [91.802, 25.990],
      [91.890, 25.578]
    ]
  },
  "turn_by_turn_instructions": [
    {
      "step": 1,
      "instruction": "Depart Guwahati Hub onto NH27",
      "distance_km": 18.2
    },
    {
      "step": 2,
      "instruction": "Reroute bypass: Turn right onto SH-6 towards Nongpoh to avoid landslide on NH6",
      "distance_km": 42.0
    }
  ]
}

```

#### **Endpoint 2: Real-Time Fleet Status Feed (WebSocket)**

* **Route:** `WS /api/v1/ws/fleet-monitor`
* **Broadcast Payload:** Sends real-time telemetry updates, active trip statuses, vehicle-to-blockage proximity warnings, and automatic reroute alerts.

---

### **6. Frontend UI Components (Web Command Center & Driver Views)**

* **Multi-Route Path Renderer:** Displays original path in muted red dashed lines and recalculated alternate path in bold bright green.
* **Fleet Matrix Side Drawer:** List of active supply vehicles, categorized by priority (e.g., Red badge for Medical Supplies, Blue for Food Grains) with live status tags (`On Route`, `Rerouted (+45m)`, `Delayed`).
* **Reroute Approval Action Panel:** For command center operators to either auto-approve or manually override suggested alternate routes.

---

### **7. Code-Generation Prompts for LLM Implementation**

#### **Prompt A: NetworkX Dynamic Graph Routing Service**

> **System Prompt for Backend LLM:**
> Write a robust Python module for a Dynamic Rerouting Engine using `FastAPI`, `networkx`, and `shapely`.
> **Requirements:**
> 1. Build a class `DynamicGraphRouter` that builds a directed graph from a list of road nodes and edges.
> 2. Implement method `compute_optimal_route(origin: tuple, destination: tuple, blocked_edge_ids: list, hazard_zones: list) -> dict`.
> 3. For any edge intersecting a hazard polygon (using `shapely.geometry`), apply a non-linear weight multiplier based on the hazard risk score.
> 4. If an edge is marked in `blocked_edge_ids`, exclude the edge entirely from the traversal graph.
> 5. Return the reconstructed GeoJSON `LineString`, cumulative distance in km, ETA in minutes, and an array of bypassed incident IDs.
> 
> 

#### **Prompt B: Route Recalculation & Vehicle Tracking Mapbox Component**

> **System Prompt for Frontend LLM:**
> Build a React component (`FleetRouteViewer.jsx`) using `react-map-gl` and Tailwind CSS.
> **Requirements:**
> 1. Render both the original route (dashed red line) and the active rerouted path (solid green line) on top of the Mapbox base map.
> 2. Display animated vehicle markers along the path updating coordinates via WebSocket.
> 3. Render a clean floating glassmorphism card on the top right showing:
> * Vehicle ID & Commodity Type
> * Status badge ("Rerouted due to Landslide")
> * Estimated Delay (e.g., "+35 mins")
> * An "Accept Route" and "Revert" button for dispatcher manual control.
> 
> 
> 
>