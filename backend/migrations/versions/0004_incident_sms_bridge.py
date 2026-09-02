"""add severity, source and readable_id to incidents (issue #74)

The satellite-SMS bridge needs to record where a report came from (so the
dashboard can render "image pending network sync" for SMS-sourced incidents)
and its severity (carried in the SMS payload but never previously stored),
plus a short human-readable id that a dispatcher and a field officer can both
read off a screen.

Guarded the same way as 0002 / 0003: create_all already carries these columns
on a fresh database, so this must be a no-op there and additive on an existing
one.

Revision ID: 0004_incident_sms_bridge
Revises: 0003_vehicle_created_at
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_incident_sms_bridge"
down_revision = "0003_vehicle_created_at"
branch_labels = None
depends_on = None

RISK_LEVEL_VALUES = ("LOW", "MODERATE", "HIGH", "CRITICAL")
INCIDENT_SOURCE_VALUES = ("APP", "SATELLITE_SMS")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("incidents"):
        return

    present = {c["name"] for c in inspector.get_columns("incidents")}

    # RiskLevel's enum type already exists (segment_risk_assessments uses it),
    # so it is reused rather than re-created under a second name.
    if "severity" not in present:
        op.add_column(
            "incidents",
            sa.Column("severity", sa.Enum(*RISK_LEVEL_VALUES, name="risklevel"), nullable=True),
        )

    if "source" not in present:
        sa.Enum(*INCIDENT_SOURCE_VALUES, name="incidentsource").create(bind, checkfirst=True)
        op.add_column(
            "incidents",
            sa.Column(
                "source",
                sa.Enum(*INCIDENT_SOURCE_VALUES, name="incidentsource"),
                nullable=True,
            ),
        )

    if "readable_id" not in present:
        op.add_column("incidents", sa.Column("readable_id", sa.String(length=20), nullable=True))
        op.create_index(
            "ix_incidents_readable_id", "incidents", ["readable_id"], unique=True
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("incidents"):
        return

    present = {c["name"] for c in inspector.get_columns("incidents")}

    if "readable_id" in present:
        op.drop_index("ix_incidents_readable_id", table_name="incidents")
        op.drop_column("incidents", "readable_id")
    if "source" in present:
        op.drop_column("incidents", "source")
        sa.Enum(name="incidentsource").drop(bind, checkfirst=True)
    if "severity" in present:
        op.drop_column("incidents", "severity")
