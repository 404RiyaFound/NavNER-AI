"""Lambda handler — Offline field report processor.

Processes batched field reports from SQS when mobile apps reconnect
after being offline in remote NER areas.
"""

import json
import logging
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    """Process a batch of offline field reports.

    Expected payload structure:
    {
        "reports": [
            {
                "report_id": "uuid",
                "type": "flood|landslide|road_damage|bridge_collapse",
                "lat": 25.5788,
                "lng": 91.8933,
                "description": "Road blocked by debris",
                "image_base64": "...",
                "reported_by": "user-uuid",
                "offline_timestamp": "2026-09-01T10:00:00Z"
            }
        ],
        "device_id": "field-device-001",
        "sync_timestamp": "2026-09-01T12:00:00Z"
    }
    """
    try:
        reports = event.get("reports", [])
        device_id = event.get("device_id", "unknown")
        sync_ts = event.get("sync_timestamp", "unknown")

        logger.info(
            "Processing %d offline reports from device %s (synced at %s)",
            len(reports), device_id, sync_ts,
        )

        processed = 0
        errors = []

        for report in reports:
            try:
                report_id = report.get("report_id", "unknown")
                report_type = report.get("type")
                lat = report.get("lat")
                lng = report.get("lng")
                description = report.get("description", "")

                if not report_type or lat is None or lng is None:
                    errors.append(f"Invalid report {report_id}: missing required fields")
                    continue

                # In production, this would write to RDS/PostGIS via Data API
                # For the hackathon, we log the successful processing
                logger.info(
                    "Processed report %s: type=%s at (%s, %s)",
                    report_id, report_type, lat, lng,
                )
                processed += 1

            except Exception as e:
                errors.append(f"Error processing report: {str(e)}")

        result = {
            "status": "SUCCESS" if not errors else "PARTIAL_SUCCESS",
            "processed": processed,
            "total": len(reports),
            "errors": errors[:5],  # Limit error list
            "device_id": device_id,
        }

        logger.info("Sync result: %s", json.dumps(result))
        return result

    except Exception as e:
        logger.error("Fatal error in field report processor: %s", str(e))
        return {
            "status": "FAILED",
            "error": str(e),
        }
