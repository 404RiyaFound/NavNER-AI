-- ============================================================================
-- NavNER-AI — Redshift ML Delay Prediction Query
-- Stage 4: Delay Prediction Matrix for Grafana Dashboard (Panel 2)
-- ============================================================================
-- Uses Amazon Redshift ML (CREATE MODEL) to predict delay probability
-- for active trips. Flags trips with > 75% delay probability as CRITICAL_RISK.
-- ============================================================================

-- ── Step 1: Create the ML model for delay prediction ─────────────────────
-- This trains a binary classification model on historical trip data.
-- Features: speed, distance remaining, hazard score, commodity type, time of day.

CREATE MODEL delay_prediction_model
FROM (
    SELECT
        t.vehicle_id,
        t.speed_kmh,
        t.commodity_type,
        t.origin_state,
        EXTRACT(HOUR FROM t.event_timestamp) AS hour_of_day,
        -- Target: 1 = delayed (speed < 10 km/h for non-urban), 0 = on-time
        CASE WHEN t.speed_kmh < 10 THEN 1 ELSE 0 END AS is_delayed
    FROM
        telemetry_stream t
    WHERE
        t.event_timestamp >= DATEADD(day, -7, GETDATE())
)
TARGET is_delayed
FUNCTION predict_delay
IAM_ROLE DEFAULT
SETTINGS (
    S3_BUCKET 'navner-analytics-ml',
    MAX_RUNTIME 3600
);


-- ── Step 2: Prediction query for the Delay Prediction Matrix panel ───────
-- Returns all currently active trips with their predicted delay probability.
-- Trips with > 75% delay probability are flagged as CRITICAL_RISK.

SELECT
    trip_id,
    vehicle_id,
    origin_state,
    dest_state,
    commodity_type,
    speed_kmh                                       AS current_speed,
    predict_delay(
        speed_kmh,
        commodity_type,
        origin_state,
        EXTRACT(HOUR FROM GETDATE())
    )                                                AS delay_probability,
    CASE
        WHEN predict_delay(
            speed_kmh,
            commodity_type,
            origin_state,
            EXTRACT(HOUR FROM GETDATE())
        ) > 0.75 THEN 'CRITICAL_RISK'
        WHEN predict_delay(
            speed_kmh,
            commodity_type,
            origin_state,
            EXTRACT(HOUR FROM GETDATE())
        ) > 0.50 THEN 'HIGH_RISK'
        WHEN predict_delay(
            speed_kmh,
            commodity_type,
            origin_state,
            EXTRACT(HOUR FROM GETDATE())
        ) > 0.25 THEN 'MODERATE_RISK'
        ELSE 'LOW_RISK'
    END                                              AS risk_classification,
    event_timestamp                                  AS last_telemetry,
    ingestion_timestamp                              AS last_ingested
FROM
    telemetry_stream
WHERE
    event_timestamp >= DATEADD(hour, -1, GETDATE())
ORDER BY
    delay_probability DESC;


-- ── Step 3: Critical risk summary for alerting ───────────────────────────
-- Aggregates critical-risk trips for the SNS dispatch pipeline.

SELECT
    origin_state,
    COUNT(*)                     AS critical_trips,
    AVG(delay_probability)       AS avg_delay_prob,
    STRING_AGG(trip_id, ', ')    AS affected_trip_ids
FROM (
    SELECT
        trip_id,
        origin_state,
        predict_delay(
            speed_kmh,
            commodity_type,
            origin_state,
            EXTRACT(HOUR FROM GETDATE())
        ) AS delay_probability
    FROM
        telemetry_stream
    WHERE
        event_timestamp >= DATEADD(hour, -1, GETDATE())
)
WHERE
    delay_probability > 0.75
GROUP BY
    origin_state
ORDER BY
    critical_trips DESC;
