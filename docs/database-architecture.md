# Database architecture

Three databases, each owned by a different actor in the system:

| Database | Owner | Holds | Technology |
| --- | --- | --- | --- |
| Mobile local store | the field officer's phone | offline incident drafts + images pending sync | SQLite (`expo-sqlite`), on-device only |
| NavNER database | the AI routing/hazard engine | vehicles, trips, incidents, risk assessments, road network | Postgres + PostGIS, recommended hosted on **Supabase** |
| Fleet Manager database | the government provisioning portal | registered vehicles — plate, class, capacity, depot, district | Postgres, recommended a **separate Supabase project** |

## Why Supabase for NavNER, and not Firebase

Issue #74's PRD calls the target "cloud-agnostic Firebase" — which is a
contradiction: Firebase Firestore is Google's proprietary NoSQL platform, not
cloud-agnostic by any definition. Genuinely cloud-agnostic means open-source
and portable across hosts, which Firestore is not and Postgres is.

Concretely, moving to Firestore instead of keeping Postgres would have cost
three things this project already depends on:

1. **The CI drift check.** `.github/workflows/ci.yml`'s `migrations` job
   autogenerates a schema diff and fails the build if a model changed without
   a migration — the direct fix for the #37 outage (a column added to the
   model, never migrated, `map-state` 500 on every request). Firestore is
   schemaless; there is nothing for Alembic to diff, so this class of bug
   becomes undetectable again.
2. **Async support.** `firebase-admin` is a synchronous SDK. Every route in
   this FastAPI backend is `async def` against `AsyncSession`; calling a sync
   SDK from inside them means blocking the event loop on every Firestore
   call, or wrapping each one in a thread-pool executor — complexity with no
   payoff when Postgres already has a mature async driver in use.
3. **The spatial queries the hazard engine is built on.** `ST_DWithin`,
   `ST_Intersects`, H3-indexed grid joins — PostGIS operations the routing
   and risk-evaluation code calls directly. Firestore has no equivalent;
   replicating them client-side would mean re-implementing PostGIS in
   application code.

**Recommendation: Supabase**, unchanged code. Supabase *is* hosted Postgres
with PostGIS available as a one-click extension, so `DATABASE_URL` just points
at a different host — same SQLAlchemy models, same Alembic migrations, same
async driver, zero new client library. It is open-source and self-hostable on
any cloud, which is what "cloud-agnostic" should mean: no proprietary API,
no single-vendor lock-in.

The SMS-bridge incidents that motivated this decision (issue #74) are stored
in the *same* `incidents` table as ordinary app submissions — see migration
`0004_incident_sms_bridge` — distinguished by a `source` column
(`SATELLITE_SMS` vs `APP`), not routed to a separate datastore. An incident is
an incident regardless of how it arrived; giving it a different database
depending on its `source` value would mean every consumer (the map, the
hazard engine, the dashboard) joining across two stores for one concept.

## Why the Fleet Manager database is genuinely separate

This was the original design in issue #65 §3.3 ("the fleet-manager portal
acts as the source of truth ... the navNER dashboard consumes" it) — a
provisioning system with its own boundary, not a table inside NavNER's
operational store. The first implementation took a shortcut (shared tables,
one database) for speed; this corrects it.

**What lives where:**

- `fleet_vehicles` (Fleet Manager DB) — the provisioning record: plate,
  class, capacity, depot, target district. What a dispatcher typed into the
  form. No geometry, no telemetry, no images — which is exactly why a plain
  Postgres instance is enough; it never needed PostGIS.
- `vehicles` / `vehicle_trips` (NavNER DB) — the operational record: live
  position, active trip, reroute history. What the routing engine reads and
  writes continuously.

**The sync boundary** is `app/services/govt_sync.py`. A registration
(`POST /api/v1/govt/fleet`) or a scenario seed writes the authoritative
record to the Fleet Manager database first, then calls
`sync_vehicle_to_navner()` to create or update the corresponding row in
NavNER's database — keyed on `license_plate`, the one identifier both
systems and a human dispatcher all agree on, since the two databases share no
primary key.

Read endpoints (`/active-fleet`, `/dashboard-summary`, `/transit-log`)
continue to query NavNER's database directly. Live position and trip state
only ever exist there; routing them through the Fleet Manager database would
mean that database needing to absorb telemetry-rate writes it was
specifically kept lean to avoid.

**Local development** runs both databases on the same Postgres server —
`navner_ai` and `fleet_manager_db` — so the split is real and testable
without two cloud accounts. Each is configured independently
(`DATABASE_URL`, `GOVT_DATABASE_URL`), so pointing them at two separate
Supabase projects in production is a configuration change, not a code change.

```bash
# Local dev — mirrors the deployed topology on one Postgres server
DATABASE_URL=postgresql+psycopg://navner:navner_secret@localhost:5433/navner_ai
GOVT_DATABASE_URL=postgresql+psycopg://navner:navner_secret@localhost:5433/fleet_manager_db

# Production — two separate Supabase projects
DATABASE_URL=postgresql://...@db.<navner-project>.supabase.co:5432/postgres
GOVT_DATABASE_URL=postgresql://...@db.<fleet-manager-project>.supabase.co:5432/postgres
```

Each database has its own Alembic migration chain:

```bash
cd backend
alembic upgrade head                       # NavNER database
alembic -c alembic_govt.ini upgrade head    # Fleet Manager database
```

## Mobile local store (issue #74)

SQLite via `expo-sqlite`, entirely on-device, no cloud dependency — this is
the tier that has to work with zero connectivity of any kind. Holds the
report metadata and the image URI while the satellite-SMS metadata is in
flight and the image is queued behind it. See
`mobile/src/services/satelliteSms.js`.

This is deliberately separate from the existing `syncQueue.js`, which handles
ordinary spotty connectivity (queue in `AsyncStorage`, sync over HTTP within
minutes of a signal returning). The satellite bridge is for the case that
tier cannot cover: no signal at all, for a duration measured in hours, where
waiting to sync is not an option and the compressed SMS is the only channel
that exists.
