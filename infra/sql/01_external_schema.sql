-- ============================================================================
-- NavNER-AI — Redshift External Schema from Kinesis Stream
-- Stage 4: Streaming Ingestion for Real-Time Analytics
-- ============================================================================
-- Run this AFTER the IngestionStack and RedshiftStack are deployed.
-- Requires: IAM role with KinesisReadOnlyAccess attached to the Redshift namespace.
-- ============================================================================

-- 1. Create the external schema linked to the Kinesis GPS telemetry stream
CREATE EXTERNAL SCHEMA kinesis_schema
FROM KINESIS
IAM_ROLE DEFAULT;

-- 2. Create a materialized view that continuously ingests from the Kinesis stream
--    This uses Redshift's native streaming ingestion — data appears within seconds.
CREATE MATERIALIZED VIEW telemetry_stream AS
SELECT
    -- Parse the JSON payload from the Kinesis record
    JSON_EXTRACT_PATH_TEXT(from_varbyte(kinesis_data, 'utf-8'), 'vehicle_id')     AS vehicle_id,
    JSON_EXTRACT_PATH_TEXT(from_varbyte(kinesis_data, 'utf-8'), 'lat')::FLOAT      AS latitude,
    JSON_EXTRACT_PATH_TEXT(from_varbyte(kinesis_data, 'utf-8'), 'lng')::FLOAT      AS longitude,
    JSON_EXTRACT_PATH_TEXT(from_varbyte(kinesis_data, 'utf-8'), 'speed')::FLOAT    AS speed_kmh,
    JSON_EXTRACT_PATH_TEXT(from_varbyte(kinesis_data, 'utf-8'), 'commodity_type')  AS commodity_type,
    JSON_EXTRACT_PATH_TEXT(from_varbyte(kinesis_data, 'utf-8'), 'origin_state')   AS origin_state,
    JSON_EXTRACT_PATH_TEXT(from_varbyte(kinesis_data, 'utf-8'), 'dest_state')     AS dest_state,
    JSON_EXTRACT_PATH_TEXT(from_varbyte(kinesis_data, 'utf-8'), 'trip_id')        AS trip_id,
    JSON_EXTRACT_PATH_TEXT(from_varbyte(kinesis_data, 'utf-8'), 'timestamp')::TIMESTAMP AS event_timestamp,
    approximate_arrival_timestamp                                                  AS ingestion_timestamp
FROM
    kinesis_schema."navner-gps-stream"
WHERE
    CAN_JSON_PARSE(from_varbyte(kinesis_data, 'utf-8'));

-- Refresh policy: auto-refresh every 60 seconds
-- (Redshift streaming MVs auto-refresh by default)
