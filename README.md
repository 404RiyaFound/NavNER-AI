# NavNER-AI

An AI-powered logistics and accessibility intelligence platform for the North Eastern Region (NER). Features real-time GIS monitoring, predictive disruption alerts, and offline-first field reporting to ensure resilient supply chains in challenging terrains.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NavNER-AI Platform                        │
├─────────────────┬──────────────────┬────────────────────────┤
│   Web Dashboard │   Mobile App     │   Backend API          │
│   (React +      │   (React Native  │   (FastAPI +           │
│    MapLibre GL)  │    + Expo)       │    PostgreSQL/PostGIS) │
│                 │                  │                        │
│ • Live map      │ • Offline-first  │ • REST endpoints       │
│ • Vehicle       │ • GPS + Camera   │ • WebSocket broadcast  │
│   tracking      │ • Sync queue     │ • Geospatial queries   │
│ • Incident feed │ • Field reports  │ • File uploads         │
└────────┬────────┴────────┬─────────┴───────────┬────────────┘
         │    WebSocket     │    REST API          │
         └────────────────►├◄────────────────────┘
                           │
                    ┌──────┴──────┐
                    │ PostgreSQL  │
                    │ + PostGIS   │
                    └─────────────┘
```

## Tech Stack

| Layer     | Technology                                    |
| --------- | --------------------------------------------- |
| Database  | PostgreSQL 16 + PostGIS 3.4                   |
| Backend   | Python 3.12, FastAPI, SQLAlchemy (async), GeoAlchemy2 |
| Web       | React 18, Vite, MapLibre GL JS               |
| Mobile    | React Native (Expo), AsyncStorage             |
| Infra     | Docker Compose                                |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL)
- [Node.js](https://nodejs.org/) ≥ 18
- [Python](https://www.python.org/) ≥ 3.11

---

## Quick Start

### 1. Database

```bash
docker compose up -d
```

This starts PostgreSQL 16 with PostGIS on `localhost:5432`.

### 2. Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend will:
- Auto-create all database tables
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

Scan the QR code with Expo Go on your phone, or press `w` for web preview.

---

## API Endpoints

| Method | Endpoint              | Description                                      |
| ------ | --------------------- | ------------------------------------------------ |
| GET    | `/api/v1/map-state`   | Returns all active vehicles and open incidents    |
| POST   | `/api/v1/telemetry`   | Ingest a GPS ping from a vehicle                  |
| POST   | `/api/v1/incident`    | Submit an incident report (multipart form + image)|
| WS     | `/ws`                 | WebSocket for real-time dashboard updates         |
| GET    | `/health`             | Health check                                      |
| GET    | `/docs`               | Swagger API documentation                         |

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

## Database Schema

| Table       | Key Columns                                                  |
| ----------- | ------------------------------------------------------------ |
| `users`     | `id`, `name`, `role`, `auth_token`, `district`               |
| `vehicles`  | `id`, `name`, `type`, `status`, `current_location` (PostGIS) |
| `incidents` | `id`, `type`, `location` (PostGIS), `image_url`, `status`    |
| `telemetry` | `id`, `vehicle_id`, `location` (PostGIS), `speed`, `timestamp` |

---

## Project Structure

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
│   │   └── routers/
│   │       ├── telemetry.py
│   │       ├── incidents.py
│   │       └── map_state.py
│   ├── uploads/             # Local photo storage
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env
├── web/                     # React command center
│   ├── src/
│   │   ├── App.jsx
│   │   ├── index.css        # Dark theme design system
│   │   ├── components/
│   │   │   ├── Header.jsx
│   │   │   ├── MapCanvas.jsx
│   │   │   └── IncidentPanel.jsx
│   │   └── hooks/
│   │       ├── useWebSocket.js
│   │       └── useMapState.js
│   └── .env
├── mobile/                  # React Native field app
│   ├── App.js
│   └── src/
│       ├── screens/
│       │   └── FieldReportScreen.jsx
│       ├── components/
│       │   ├── NetworkBadge.jsx
│       │   ├── IncidentForm.jsx
│       │   └── PhotoCapture.jsx
│       └── services/
│           └── syncQueue.js
├── docs/
│   └── problem_statement.md
├── prds/
│   └── stage-1.md
├── docker-compose.yml
└── CONTRIBUTING.md
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable       | Default                                                     |
| -------------- | ----------------------------------------------------------- |
| `DATABASE_URL` | `postgresql+psycopg://navner:navner_secret@localhost:5432/navner_ai` |
| `UPLOAD_DIR`   | `./uploads`                                                 |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000`                |

### Web Dashboard (`web/.env`)

| Variable       | Default                       |
| -------------- | ----------------------------- |
| `VITE_API_URL` | `http://localhost:8000`       |
| `VITE_WS_URL`  | `ws://localhost:8000/ws`      |
| `VITE_MAP_TILE_URL` | Stadia dark raster tiles (keyless on localhost only) |

Copy `backend/.env.example` and `web/.env.example` to `.env` in their respective
directories to get started.

> **Already running Postgres locally?** A native install owns `127.0.0.1:5432`,
> and a specific-address bind beats Docker's wildcard bind — so `localhost:5432`
> reaches the native server, not the container. The backend then fails with
> `FATAL: role "navner" does not exist`. Publish the container on a spare port via
> `docker-compose.override.yml` and point `DATABASE_URL` at it; see
> `backend/.env.example` for the snippet.

> **Deploying off localhost?** The default basemap tile endpoint authorises only
> requests with a `localhost` referer and returns HTTP 401 elsewhere, which renders
> a blank map. Set `VITE_MAP_TILE_URL` to a keyed tile URL before deploying.

---

## License

See [LICENSE](LICENSE) for details.
