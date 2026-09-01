"""Automated Alert Dispatch System — Two-tier notification pipeline.

Separates alerts into CRITICAL (immediate dispatch) and INFORMATIONAL
(batched hourly summaries) to prevent notification fatigue during
extreme monsoon events in the NER.

Falls back gracefully when AWS credentials are unavailable (local dev mode).
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session
from app.models import AlertLog, AlertTier
from app.config import settings

logger = logging.getLogger(__name__)

# ── Alert tier definitions ────────────────────────────────────────────────────

CRITICAL_TRIGGERS = frozenset({
    "IMMEDIATE_REROUTE",
    "bridge_collapse",
    "landslide",
    "CRITICAL",
    "STUCK_VEHICLE",
    "HIGH_PROBABILITY_LANDSLIDE",
})

INFORMATIONAL_TRIGGERS = frozenset({
    "SPEED_RESTRICTION",
    "road_damage",
    "MODERATE",
    "weather_advisory",
    "STANDARD_DELAY",
})


class AlertDispatcher:
    """Two-tier alert dispatch with optional AWS SNS integration.

    In local dev mode (no AWS credentials), alerts are logged but not
    dispatched to SNS.
    """

    def __init__(self, sns_topic_arn: str | None = None) -> None:
        self._sns_topic_arn = sns_topic_arn
        self._sns_client = None
        self._batch_buffer: list[dict[str, Any]] = []
        self._dispatch_log: list[dict[str, Any]] = []

        # Try to initialize SNS client
        if sns_topic_arn:
            try:
                import boto3
                self._sns_client = boto3.client("sns")
                logger.info("[AlertDispatcher] SNS client initialized — topic: %s", sns_topic_arn)
            except Exception as e:
                logger.warning(
                    "[AlertDispatcher] AWS SNS unavailable (local dev mode): %s", e
                )
                self._sns_client = None

    # ── Public API ────────────────────────────────────────────────────────────

    async def process_event(self, event: dict[str, Any], db: AsyncSession | None = None) -> dict[str, Any]:
        """Route an event to the appropriate dispatch tier.

        Parameters
        ----------
        event : dict
            Must contain: event_type, severity, message, source.
            Optional: location, vehicle_id, trip_id, timestamp.

        Returns
        -------
        dict with keys: tier, dispatched, logged.
        """
        event_type = event.get("event_type", "")
        severity = event.get("severity", "")
        timestamp = event.get("timestamp", datetime.now(timezone.utc).isoformat())

        # Classify into tier
        tier = self._classify_tier(event_type, severity)

        if tier == "CRITICAL":
            dispatched = await self._dispatch_critical(event, timestamp)
        else:
            dispatched = self._buffer_informational(event, timestamp)

        # Log the event
        log_entry = {
            "tier": tier,
            "event_type": event_type,
            "severity": severity,
            "message": event.get("message", ""),
            "timestamp": timestamp,
            "dispatched": dispatched,
        }
        # In-memory log
        self._dispatch_log.append(log_entry)

        # Database persistence
        tier_enum = AlertTier.CRITICAL if tier == "CRITICAL" else AlertTier.INFORMATIONAL
        
        async def _persist(session: AsyncSession):
            db_log = AlertLog(
                tier=tier_enum,
                event_type=event_type,
                severity=severity,
                message=event.get("message", ""),
                source=event.get("source", "navner-ai"),
                delivery_status="dispatched" if dispatched else "buffered",
                vehicle_id=event.get("vehicle_id"),
                trip_id=event.get("trip_id"),
            )
            session.add(db_log)
            await session.commit()

        if db:
            await _persist(db)
        else:
            async with async_session() as session:
                await _persist(session)

        return {"tier": tier, "dispatched": dispatched, "logged": True}

    async def dispatch_batched_summary(self, db: AsyncSession | None = None) -> dict[str, Any]:
        """Dispatch all buffered INFORMATIONAL events as a batched summary.

        Called periodically (every 60 minutes) by the scheduler.
        """
        if not self._batch_buffer:
            return {"dispatched": False, "count": 0, "reason": "no_events"}

        # Group events by type
        grouped: dict[str, list[dict]] = defaultdict(list)
        for event in self._batch_buffer:
            grouped[event.get("event_type", "general")].append(event)

        # Build summary message
        summary_lines = [
            f"📊 NavNER-AI Informational Summary — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            f"Total events: {len(self._batch_buffer)}",
            "",
        ]

        for event_type, events in grouped.items():
            summary_lines.append(f"▸ {event_type}: {len(events)} event(s)")
            for evt in events[:3]:  # Show first 3 of each type
                summary_lines.append(f"  — {evt.get('message', 'No details')}")
            if len(events) > 3:
                summary_lines.append(f"  ... and {len(events) - 3} more")
            summary_lines.append("")

        summary = "\n".join(summary_lines)

        # Dispatch via SNS (or log in dev mode)
        dispatched = False
        if self._sns_client and self._sns_topic_arn:
            try:
                self._sns_client.publish(
                    TopicArn=self._sns_topic_arn,
                    Subject="📊 NavNER-AI: Informational Summary",
                    Message=summary,
                    MessageAttributes={
                        "alert_tier": {
                            "DataType": "String",
                            "StringValue": "INFORMATIONAL",
                        },
                    },
                )
                dispatched = True
                logger.info("[AlertDispatcher] Batched summary dispatched (%d events)", len(self._batch_buffer))
            except Exception as e:
                logger.error("[AlertDispatcher] Failed to dispatch summary: %s", e)
        else:
            logger.info("[AlertDispatcher] [DEV MODE] Batched summary:\n%s", summary)
            dispatched = True  # Consider logged as dispatched in dev

        # Persist summary event to database
        async def _persist_summary(session: AsyncSession):
            db_log = AlertLog(
                tier=AlertTier.INFORMATIONAL,
                event_type="BATCHED_SUMMARY",
                severity="INFO",
                message=summary,
                source="navner-ai-scheduler",
                delivery_status="dispatched" if dispatched else "failed"
            )
            session.add(db_log)
            await session.commit()

        if db:
            await _persist_summary(db)
        else:
            async with async_session() as session:
                await _persist_summary(session)

        count = len(self._batch_buffer)
        self._batch_buffer.clear()

        return {"dispatched": dispatched, "count": count}

    def get_recent_alerts(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return the most recent alert log entries."""
        return self._dispatch_log[-limit:][::-1]

    def get_buffered_count(self) -> int:
        """Return the number of events currently in the batch buffer."""
        return len(self._batch_buffer)

    # ── Internal Methods ──────────────────────────────────────────────────────

    def _classify_tier(self, event_type: str, severity: str) -> str:
        """Classify an event into CRITICAL or INFORMATIONAL tier."""
        if event_type in CRITICAL_TRIGGERS or severity in CRITICAL_TRIGGERS:
            return "CRITICAL"
        return "INFORMATIONAL"

    async def _dispatch_critical(self, event: dict, timestamp: str) -> bool:
        """Immediately dispatch a critical alert via SNS."""
        subject = f"🚨 NavNER CRITICAL: {event.get('event_type', 'Alert')}"
        message = json.dumps({
            "alert_tier": "CRITICAL",
            "event_type": event.get("event_type"),
            "severity": event.get("severity"),
            "message": event.get("message"),
            "location": event.get("location"),
            "vehicle_id": event.get("vehicle_id"),
            "trip_id": event.get("trip_id"),
            "timestamp": timestamp,
            "source": event.get("source", "navner-ai"),
        }, indent=2)

        if self._sns_client and self._sns_topic_arn:
            try:
                self._sns_client.publish(
                    TopicArn=self._sns_topic_arn,
                    Subject=subject[:100],  # SNS subject limit
                    Message=message,
                    MessageAttributes={
                        "alert_tier": {
                            "DataType": "String",
                            "StringValue": "CRITICAL",
                        },
                        "event_type": {
                            "DataType": "String",
                            "StringValue": event.get("event_type", "unknown"),
                        },
                    },
                )
                logger.info("[AlertDispatcher] CRITICAL alert dispatched: %s", event.get("event_type"))
                return True
            except Exception as e:
                logger.error("[AlertDispatcher] SNS dispatch failed: %s", e)
                return False
        else:
            # Dev mode — log the alert
            logger.info(
                "[AlertDispatcher] [DEV MODE] CRITICAL alert: %s — %s",
                event.get("event_type"),
                event.get("message"),
            )
            return True

    def _buffer_informational(self, event: dict, timestamp: str) -> bool:
        """Buffer an informational event for batched dispatch."""
        self._batch_buffer.append({
            **event,
            "buffered_at": timestamp,
        })
        logger.debug(
            "[AlertDispatcher] Buffered INFORMATIONAL event: %s (buffer size: %d)",
            event.get("event_type"),
            len(self._batch_buffer),
        )
        return False  # Not dispatched yet — buffered


# ── Module-level singleton ────────────────────────────────────────────────────
# Initialized without SNS in dev mode; reconfigured in main.py if AWS is available
alert_dispatcher = AlertDispatcher(sns_topic_arn=settings.SNS_TOPIC_ARN)
