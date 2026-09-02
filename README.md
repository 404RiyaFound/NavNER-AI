<div align="center">

<img src="./logo/banner.svg" alt="NavNER-AI" width="560" />

**AI-powered logistics intelligence platform for India's North Eastern Region.**

NavNER-AI is a full-stack GIS operations platform that uses **RandomForest risk classification**, **A\* pathfinding**, and **real-time WebSocket telemetry** to keep supply chains resilient in one of the world's most challenging terrains — with a React command center, offline-first Expo field app, and a FastAPI + PostGIS backend.

[![⭐ Stars](https://img.shields.io/github/stars/YASHK-arch/NavNER-AI?label=%E2%AD%90%20Stars&style=flat-square&color=FF5B22)](https://github.com/YASHK-arch/NavNER-AI/stargazers)
[![🍴 Forks](https://img.shields.io/github/forks/YASHK-arch/NavNER-AI?label=%F0%9F%8D%B4%20Forks&style=flat-square&color=4a9eff)](https://github.com/YASHK-arch/NavNER-AI/forks)
[![Issues](https://img.shields.io/github/issues/YASHK-arch/NavNER-AI?style=flat-square&color=e3624b)](https://github.com/YASHK-arch/NavNER-AI/issues)
[![Open PRs](https://img.shields.io/github/issues-pr/YASHK-arch/NavNER-AI?label=open+PRs&style=flat-square&color=2da44e)](https://github.com/YASHK-arch/NavNER-AI/pulls?q=is%3Apr+is%3Aopen)
[![Merged PRs](https://img.shields.io/github/issues-pr-closed-raw/YASHK-arch/NavNER-AI?label=merged+PRs&style=flat-square&color=8957e5)](https://github.com/YASHK-arch/NavNER-AI/pulls?q=is%3Apr+is%3Amerged)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Python](https://img.shields.io/badge/python-3.12-yellow?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Expo SDK](https://img.shields.io/badge/Expo-SDK%2054-000000?style=flat-square&logo=expo&logoColor=white)](https://expo.dev)

<br />

[**Report a Bug**](https://github.com/YASHK-arch/NavNER-AI/issues/new) · [**Request a Feature**](https://github.com/YASHK-arch/NavNER-AI/issues/new) · [**API Docs**](http://localhost:8000/docs) · [**Contributing**](./CONTRIBUTING.md)

</div>

---

## Overview

The North Eastern Region of India — spanning Assam, Meghalaya, Manipur, and neighbouring states — faces persistent logistics failures: landslides cut highways, floods sever NH-27, and hill terrain makes rerouting non-trivial. NavNER-AI solves this at **three layers**:

1. **Web Command Center** — A real-time React + MapLibre GL dashboard with live fleet tracking, hazard overlays, AI delay predictions, and an analytics suite.
2. **Mobile Field App** — An offline-first Expo app for field operatives to submit geo-tagged incident reports with photos, with a local sync queue that resyncs automatically when connectivity returns.
3. **AI Backend Engine** — A FastAPI service wired to PostgreSQL/PostGIS that runs spatial H3 grid risk scoring (RandomForest), A\* route optimization, and a 4-tier alert dispatch system — all surfaced in real time via WebSocket.

---

## ✨ Features

### Command Center (Web)
- 🗺️ **Live Fleet Map** — MapLibre GL dark basemap with animated vehicle markers, hazard zone overlays, and route polylines
- 📊 **Analytics Dashboard** — KPI cards, AI delay prediction matrix, district-wise delay spike chart, and a reroute audit timeline
- ⚡ **WebSocket Updates** — Sub-second fleet position and incident feed updates without polling
- 🔴 **Alert Banner** — Tiered critical / informational alert system at the top of the Command Center

### Mobile Field App
- 📡 **Offline-First** — Incidents queued locally in AsyncStorage and synced when internet returns
- 📷 **Photo Capture** — Native camera integration for documenting road hazards, accidents, and blockages
- 📍 **GPS Location** — Auto-attaches precise coordinates to every incident report
- 🚛 **Live Fleet View** — Full-screen map with animated truck markers, tap-to-select truck info cards, and an "Accept AI Reroute" CTA

### AI & Backend
- 🤖 **RandomForest Risk Engine** — Scores each H3 hexagonal grid cell for landslide + flood risk using spatial features
- 🔀 **A\* Routing Engine** — Finds optimal alternate routes around high-risk grid cells in real time
- 🔔 **4-Tier Alert Dispatch** — Classifies alerts into Critical / High / Medium / Informational and routes to AWS SNS (Stage 4)
- 🌦️ **Weather Integration** — Pulls live weather data from Open-Meteo for precipitation-aware risk scoring

---

## 🏗️ Architecture

```mermaid
flowchart TD

subgraph web["Web Command Center"]
  node_map["MapCanvas\nMapLibre GL live map"]
  node_analytics["AnalyticsDashboard\nKPIs · Delay Matrix · Audit"]
  node_ws_hook["useWebSocket\nreal-time hook"]
  node_fleet_hook["useFleetStatus / useHazardMap"]
end

subgraph mobile["Mobile Field App (Expo)"]
  node_mapscreen["MapScreen\nfleet tracking map"]
  node_fieldreport["FieldReportScreen\noffline incident form"]
  node_syncqueue["syncQueue\nAsyncStorage buffer"]
end

subgraph backend["FastAPI Backend"]
  node_api["REST Routers\ntelemetry · incidents · routing"]
  node_ws["WebSocket Manager\n/ws broadcast"]
  node_risk["RiskEngine\nRandomForest H3 scoring"]
  node_router["RoutingEngine\nA* pathfinding"]
  node_alerts["AlertDispatcher\n4-tier SNS"]
  node_scheduler["Scheduler\nCRON risk sweep"]
end

subgraph data["Data Layer"]
  node_pg[("PostgreSQL 16\n+ PostGIS 3.4")]
  node_uploads["Local Uploads\nphoto storage"]
end

node_ws_hook -->|"WebSocket"| node_ws
node_fleet_hook -->|"REST"| node_api
node_map --> node_ws_hook
node_analytics --> node_fleet_hook
node_mapscreen -->|"REST"| node_api
node_fieldreport --> node_syncqueue
node_syncqueue -->|"POST /incident"| node_api
node_api --> node_risk
node_api --> node_router
node_risk --> node_alerts
node_scheduler --> node_risk
node_api --> node_pg
node_api --> node_uploads
node_ws --> node_ws_hook
```

---

## 🛠️ Tech Stack

| Layer | Technology |
| --- | --- |
| **Database** | PostgreSQL 16 + PostGIS 3.4 |
| **Backend** | Python 3.12, FastAPI, SQLAlchemy (async), GeoAlchemy2 |
| **AI / ML** | scikit-learn RandomForest, A\* graph search (NetworkX) |
| **Web** | React 18, Vite, MapLibre GL JS |
| **Mobile** | React Native 0.81, Expo SDK 54, react-native-maps |
| **Infra** | Docker Compose, AWS CDK (Stage 4), SNS |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — runs PostgreSQL 16 + PostGIS
- [Node.js](https://nodejs.org/) ≥ 18 — web and mobile
- [Python](https://www.python.org/) ≥ 3.11 — backend
- [Expo Go](https://expo.dev/go) app on your phone — mobile preview

---

## 🚀 Quick Start

### 1. Database

```bash
docker compose up -d
```

Starts PostgreSQL 16 with PostGIS on `localhost:5432`.

### 2. Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

The backend will:
- Run database migrations via Alembic
- Seed demo data (3 vehicles, 3 users, 3 incidents across NER)
- Serve the API at `http://localhost:8000`
- API docs at `http://localhost:8000/docs`

### 3. Web Dashboard

```bash
cd web
npm install
npm run dev
```

Opens the Command Center at `http://localhost:5173`.

### 4. Mobile App

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone, or press `w` for web preview.

> **Note:** The mobile app uses `react-native-maps 1.20.1` which is the version bundled with Expo SDK 54. Do not upgrade this package independently as it will break native map rendering in Expo Go.

### 5. Govt Fleet Manager

```bash
cd fleet-manager
npm install
npm run dev
```

Opens the Government / Agency Fleet Manager dashboard at `http://localhost:5174` (or next available port).

---

## 📡 API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/map-state` | All active vehicles and open incidents |
| `POST` | `/api/v1/telemetry` | Ingest a GPS ping from a vehicle |
| `POST` | `/api/v1/incident` | Submit an incident report (multipart + image) |
| `GET` | `/api/v1/analytics/hazard-map` | Spatial hazard map (GeoJSON) |
| `POST` | `/api/v1/analytics/evaluate-grid` | Trigger batch H3 grid cell evaluation |
| `GET` | `/api/v1/dashboard/consignment-state` | Fleet summary and logistics status |
| `GET` | `/api/v1/dashboard/delay-prediction` | ETA updates based on current hazard data |
| `GET` | `/api/v1/dashboard/fleet-summary` | Overall fleet health and dispatch metrics |
| `GET` | `/api/v1/dashboard/reroute-audit` | Historical reroute decisions |
| `GET` | `/api/v1/dashboard/alert-log` | Recent critical and informational alerts |
| `POST` | `/api/v1/routing/calculate-route` | Optimal route given hazard conditions |
| `GET` | `/api/v1/routing/fleet-status` | Live fleet assignment and paths |
| `WS` | `/ws` | WebSocket — real-time dashboard updates |
| `GET` | `/health` | Health check |
| `GET` | `/docs` | Swagger API documentation |

### Example: Submit Telemetry

```bash
curl -X POST http://localhost:8000/api/v1/telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": "<UUID from seed data>",
    "lat": 26.15,
    "lng": 91.74,
    "speed": 45.0
  }'
```

### Example: Submit Incident

```bash
curl -X POST http://localhost:8000/api/v1/incident \
  -F "type=landslide" \
  -F "lat=25.57" \
  -F "lng=91.89" \
  -F "description=Road blocked near Shillong bypass"
```

---

## 🗄️ Database Schema

| Table | Key Columns |
| --- | --- |
| `users` | `id`, `name`, `role`, `auth_token`, `district` |
| `vehicles` | `id`, `name`, `type`, `status`, `current_location` (PostGIS) |
| `incidents` | `id`, `type`, `location` (PostGIS), `image_url`, `status` |
| `telemetry` | `id`, `vehicle_id`, `location` (PostGIS), `speed`, `timestamp` |
| `spatial_grid_cells` | `h3_index`, `center_point` (PostGIS), `elevation`, `slope` |
| `segment_risk_assessments` | `id`, `grid_cell_id`, `landslide_risk_score`, `flood_risk_score` |
| `AlertLog` | `id`, `tier`, `event_type`, `severity`, `message`, `timestamp` |

---

## 📁 Project Structure

```
NavNER-AI/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── main.py          # App entry, CORS, WebSocket
│   │   ├── config.py        # Environment settings
│   │   ├── database.py      # Async SQLAlchemy engine
│   │   ├── models.py        # ORM models with PostGIS
│   │   ├── schemas.py       # Pydantic schemas
│   │   ├── websocket.py     # Connection manager
│   │   ├── seed.py          # Demo data seeder
│   │   ├── risk_engine.py   # RandomForest risk classification
│   │   ├── routing_engine.py# A* pathfinding and rerouting
│   │   ├── alert_dispatcher.py # 4-tier alert dispatch and SNS
│   │   ├── scheduler.py     # Background CRON tasks
│   │   ├── weather_service.py # Open-Meteo integration
│   │   └── routers/
│   │       ├── analytics.py # Hazard map and dispatch
│   │       ├── dashboard.py # KPIs and delay predictions
│   │       ├── routing.py   # Routes and fleet status
│   │       ├── telemetry.py
│   │       ├── incidents.py
│   │       └── map_state.py
│   ├── uploads/             # Local photo storage
│   ├── requirements.txt
│   └── Dockerfile
├── web/                     # React command center
│   ├── src/
│   │   ├── App.jsx
│   │   ├── index.css        # Dark theme design system
│   │   ├── components/
│   │   │   ├── AlertBanner.jsx
│   │   │   ├── AnalyticsDashboard.jsx
│   │   │   ├── FleetRouteViewer.jsx
│   │   │   ├── FleetSideDrawer.jsx
│   │   │   ├── HazardMapOverlay.jsx
│   │   │   ├── Header.jsx
│   │   │   ├── MapCanvas.jsx
│   │   │   ├── RouteIntelligencePanel.jsx
│   │   │   └── TripDetailPanel.jsx
│   │   └── hooks/
│   │       ├── useAnalytics.js
│   │       ├── useFleetStatus.js
│   │       ├── useHazardMap.js
│   │       ├── useMapState.js
│   │       └── useWebSocket.js
│   └── .env
├── mobile/                  # React Native field app
│   ├── App.js
│   └── src/
│       ├── screens/
│       │   ├── MapScreen.jsx      # Live fleet tracking map
│       │   ├── AnalyticsScreen.jsx
│       │   └── FieldReportScreen.jsx
│       ├── components/
│       │   ├── BottomSheet.jsx
│       │   ├── TruckMarker.jsx
│       │   ├── IncidentForm.jsx
│       │   └── PhotoCapture.jsx
│       └── services/
│           ├── mockFleet.js
│           └── syncQueue.js
├── infra/                   # AWS CDK Infrastructure (Stage 4)
│   ├── app.py
│   ├── lambda/              # Data processing Lambdas
│   ├── sql/                 # Redshift external schema and views
│   └── stacks/              # CDK Stacks (Ingestion, Redshift, StepFunctions)
├── docs/
│   ├── problem_statement.md
│   └── problems.md
├── prds/
│   └── stage-1.md
├── logo/
│   └── banner.svg
├── docker-compose.yml
└── CONTRIBUTING.md
```

---

## ⚙️ Environment Variables

### Backend (`backend/.env`)

| Variable | Default |
| --- | --- |
| `DATABASE_URL` | `postgresql+psycopg://navner:navner_secret@localhost:5432/navner_ai` |
| `UPLOAD_DIR` | `./uploads` |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` |

### Web Dashboard (`web/.env`)

| Variable | Default |
| --- | --- |
| `VITE_API_URL` | `http://localhost:8000` |
| `VITE_WS_URL` | `ws://localhost:8000/ws` |
| `VITE_MAP_TILE_URL` | Stadia dark raster tiles (keyless on localhost only) |

Copy `backend/.env.example` and `web/.env.example` to `.env` in their respective directories to get started.

> **Already running Postgres locally?** A native install owns `127.0.0.1:5432`, and a specific-address bind beats Docker's wildcard bind — so `localhost:5432` reaches the native server, not the container. Publish the container on a spare port via `docker-compose.override.yml` and point `DATABASE_URL` at it; see `backend/.env.example` for the snippet.

> **Deploying off localhost?** The default basemap tile endpoint authorises only requests with a `localhost` referer. Set `VITE_MAP_TILE_URL` to a keyed tile URL before deploying.

---

## License

See [LICENSE](LICENSE) for details.
