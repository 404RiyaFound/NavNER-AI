"""add vehicles.created_at for period-over-period growth (issue #65 §5)

The government dashboard's breakdown tables carry a "% Growth" column. Growth is
only meaningful against a prior period, and `vehicles` had no timestamp at all —
so the column could previously only have been filled with invented numbers.

Backfilled to NULL rather than to now(): a vehicle that existed before this
migration has an unknown registration date, and claiming it registered at
migration time would inflate the first period's growth. NULL reads as "not
counted in either period", which is the truthful answer.

Revision ID: 0003_vehicle_created_at
Revises: 0002_vehicle_provisioning
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_vehicle_created_at"
down_revision = "0002_vehicle_provisioning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("vehicles"):
        return

    present = {c["name"] for c in inspector.get_columns("vehicles")}
    if "created_at" not in present:
        op.add_column(
            "vehicles",
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("vehicles"):
        return

    if "created_at" in {c["name"] for c in inspector.get_columns("vehicles")}:
        op.drop_column("vehicles", "created_at")
