-- ============================================================================
-- NavNER-AI — Redshift Materialized Views for Grafana Dashboard Panels
-- Stage 4: Centralized Multi-District Analytics
-- ============================================================================

-- ── Panel 1: Consignment Stream (Current Consignment State) ──────────────
-- Aggregates number_of_consignments and running_fleet by origin_state.
-- Grafana query: SELECT * FROM consignment_stream ORDER BY total_consignments DESC;

CREATE MATERIALIZED VIEW consignment_stream AS
SELECT
    origin_state,
    COUNT(DISTINCT trip_id)                                    AS total_consignments,
    COUNT(DISTINCT vehicle_id)                                 AS running_fleet,
    COUNT(DISTINCT CASE WHEN speed_kmh > 5 THEN vehicle_id END) AS vehicles_moving,
    COUNT(DISTINCT CASE WHEN speed_kmh <= 5 THEN vehicle_id END) AS vehicles_stopped,
    ROUND(AVG(speed_kmh), 1)                                   AS avg_speed_kmh,
    MAX(ingestion_timestamp)                                   AS last_updated
FROM
    telemetry_stream
WHERE
    event_timestamp >= DATEADD(hour, -1, GETDATE())
GROUP BY
    origin_state;

-- Auto-refresh every 60 seconds
-- ALTER MATERIALIZED VIEW consignment_stream AUTO REFRESH YES;


-- ── Panel 3: Fleet Summary Board ─────────────────────────────────────────
-- Aggregated metrics grouped by origin state: total fleet, active, maintenance.
-- Grafana query: SELECT * FROM fleet_summary_board;

CREATE MATERIALIZED VIEW fleet_summary_board AS
SELECT
    origin_state,
    COUNT(DISTINCT vehicle_id)                                   AS total_vehicles,
    COUNT(DISTINCT CASE WHEN speed_kmh > 0 THEN vehicle_id END)  AS active_vehicles,
    COUNT(DISTINCT trip_id)                                      AS total_trips,
    SUM(CASE WHEN commodity_type = 'MEDICINE' THEN 1 ELSE 0 END) AS medicine_trips,
    SUM(CASE WHEN commodity_type = 'FOOD_GRAINS' THEN 1 ELSE 0 END) AS food_trips,
    SUM(CASE WHEN commodity_type = 'FUEL' THEN 1 ELSE 0 END)    AS fuel_trips,
    SUM(CASE WHEN commodity_type = 'GENERAL' THEN 1 ELSE 0 END) AS general_trips,
    ROUND(AVG(speed_kmh), 1)                                     AS avg_fleet_speed,
    MAX(ingestion_timestamp)                                     AS last_updated
FROM
    telemetry_stream
WHERE
    event_timestamp >= DATEADD(hour, -24, GETDATE())
GROUP BY
    origin_state;


-- ── Panel 4: Reroute Audit (24-hour window) ──────────────────────────────
-- This view would join with the application database's reroute_logs table.
-- For the streaming layer, we track telemetry anomalies that triggered reroutes.

CREATE MATERIALIZED VIEW reroute_audit_24h AS
SELECT
    DATE_TRUNC('hour', event_timestamp) AS hour_bucket,
    origin_state,
    COUNT(DISTINCT trip_id)             AS trips_monitored,
    COUNT(DISTINCT CASE
        WHEN speed_kmh < 5 THEN trip_id
    END)                                AS potentially_stuck,
    ROUND(AVG(speed_kmh), 1)            AS avg_speed,
    MIN(speed_kmh)                      AS min_speed,
    MAX(ingestion_timestamp)            AS last_updated
FROM
    telemetry_stream
WHERE
    event_timestamp >= DATEADD(hour, -24, GETDATE())
GROUP BY
    DATE_TRUNC('hour', event_timestamp),
    origin_state
ORDER BY
    hour_bucket DESC;
