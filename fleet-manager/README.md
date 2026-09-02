# Government Fleet Manager Portal

The provisioning origin for NavNER-AI (issue #65). Government authorities
register vehicles here; the NavNER command centre in `web/` consumes them.

Deliberately styled as an NIC/VAHAN government portal — light, dense, square
corners — in contrast to the dark operations console. The two dashboards are
meant to look nothing alike.

## Running

```bash
# 1. Backend (from repo root)
cd backend && alembic upgrade head
uvicorn app.main:app --host :: --port 8000

# 2. Portal
cd fleet-manager && npm install && npm run dev   # http://localhost:5174
```

`web/` runs on 5173 and this runs on 5174, so both can be open during a demo.
Requests to `/api` are proxied to the backend on the same origin, so no CORS
configuration is needed in dev.

## Provisioning the demo scenario

"Provision Scenario Fleet (50)" seeds the Assam scenario: 30 FCI heavy trucks on
the NH corridors out of Guwahati and 20 last-mile vehicles (4x4 pickups, NDRF
boats, ambulances) inside the flood districts. Idempotent on licence plate, so
it is safe to press twice — it tops the fleet up rather than duplicating it.

## API consumed

| Endpoint | Used for |
| --- | --- |
| `GET /api/v1/govt/dashboard-summary` | the five KPI blocks and their tables |
| `GET /api/v1/govt/active-fleet?zone=&status=` | the fleet list and zone filter |
| `POST /api/v1/govt/fleet` | the registration modal |
| `POST /api/v1/govt/simulate/seed` | the scenario button |

## Two deliberate departures from the issue

**Charts are flat, not "3D-style".** A 3D extrusion makes a bar's top face read
above its true value and its depth compete with its height, so equal numbers
look different depending on position. Everything that makes the reference
recognisable is kept: panel chrome, gridlines, per-bar value labels, the rotated
category axis.

**The third table column is real growth, not mock data.** It is computed from
`vehicles.created_at` over the last 30 days against the previous 30, added in
migration `0003`. Where a district has no registrations in the prior window the
cell shows an em dash rather than a number — percentage growth from zero is
undefined, and an invented trend arrow on a government dashboard is worse than
no arrow.
