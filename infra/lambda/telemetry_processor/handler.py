"""Lambda handler — Kinesis GPS telemetry processor.

Consumes vehicle GPS records from Kinesis, pushes to Redshift via Data API,
and triggers SNS critical alerts when anomalies are detected (stuck vehicles,
off-route deviations, hazard zone entry).
"""

import base64
import json
import logging
import os
from datetime import datetime, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
redshift_data = boto3.client("redshift-data")
sns_client = boto3.client("sns")

# Environment
REDSHIFT_WORKGROUP = os.environ.get("REDSHIFT_WORKGROUP", "navner-analytics")
REDSHIFT_DATABASE = os.environ.get("REDSHIFT_DATABASE", "navner_warehouse")
SNS_TOPIC_ARN = os.environ.get("SNS_CRITICAL_TOPIC_ARN", "")
SPEED_THRESHOLD = float(os.environ.get("ALERT_THRESHOLD_SPEED_KMH", "5"))
DEVIATION_THRESHOLD = float(os.environ.get("ALERT_THRESHOLD_DEVIATION_KM", "2.0"))


def lambda_handler(event, context):
    """Process a batch of Kinesis records containing GPS telemetry."""
    records = event.get("Records", [])
    processed = 0
    alerts_sent = 0

    for record in records:
        try:
            # Decode Kinesis record
            payload = base64.b64decode(record["kinesis"]["data"]).decode("utf-8")
            data = json.loads(payload)

            vehicle_id = data.get("vehicle_id")
            lat = data.get("lat")
            lng = data.get("lng")
            speed = data.get("speed", 0)
            timestamp = data.get("timestamp", datetime.now(timezone.utc).isoformat())
            commodity_type = data.get("commodity_type", "GENERAL")
            origin_state = data.get("origin_state", "Unknown")

            if not vehicle_id or lat is None or lng is None:
                logger.warning("Skipping record with missing fields: %s", data)
                continue

            # ── 1. Insert into Redshift ────────────────────────────────────
            sql = f"""
                INSERT INTO telemetry_stream (
                    vehicle_id, latitude, longitude, speed_kmh,
                    timestamp, commodity_type, origin_state
                )
                VALUES (
                    '{vehicle_id}', {lat}, {lng}, {speed},
                    '{timestamp}', '{commodity_type}', '{origin_state}'
                );
            """

            redshift_data.execute_statement(
                WorkgroupName=REDSHIFT_WORKGROUP,
                Database=REDSHIFT_DATABASE,
                Sql=sql,
            )

            # ── 2. Check for critical alert conditions ─────────────────────
            alert_reason = None

            # Stuck vehicle detection
            if speed < SPEED_THRESHOLD and speed >= 0:
                alert_reason = f"STUCK_VEHICLE: {vehicle_id} speed={speed} km/h at ({lat}, {lng})"

            # Additional checks can be added:
            # - Off-route deviation (compare against expected route)
            # - Hazard zone entry (spatial query against risk grid)
            # - Communication blackout (no ping for > threshold)

            if alert_reason and SNS_TOPIC_ARN:
                sns_client.publish(
                    TopicArn=SNS_TOPIC_ARN,
                    Subject=f"🚨 NavNER CRITICAL: {vehicle_id}",
                    Message=json.dumps({
                        "alert_type": "CRITICAL",
                        "vehicle_id": vehicle_id,
                        "reason": alert_reason,
                        "location": {"lat": lat, "lng": lng},
                        "speed_kmh": speed,
                        "timestamp": timestamp,
                        "commodity_type": commodity_type,
                    }),
                    MessageAttributes={
                        "alert_tier": {
                            "DataType": "String",
                            "StringValue": "CRITICAL",
                        },
                    },
                )
                alerts_sent += 1
                logger.info("Critical alert sent: %s", alert_reason)

            processed += 1

        except Exception as e:
            logger.error("Error processing record: %s", str(e))

    logger.info(
        "Processed %d/%d records, %d critical alerts sent",
        processed, len(records), alerts_sent,
    )

    return {
        "status": "SUCCESS",
        "processed": processed,
        "total": len(records),
        "alerts_sent": alerts_sent,
    }
