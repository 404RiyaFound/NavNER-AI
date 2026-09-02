"""create fleet_vehicles (Fleet Manager provisioning system of record)

Revision ID: govt_0001
Revises:
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "govt_0001"
down_revision = None
branch_labels = None
depends_on = None

VEHICLE_CLASS_VALUES = ("HEAVY_TRUCK", "PICKUP_4X4", "AMBULANCE", "NDRF_BOAT", "UTILITY")


def upgrade() -> None:
    op.create_table(
        "fleet_vehicles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # unique=True is expressed via the index below, not here — matching what
        # create_all actually produces for a Column(unique=True, index=True):
        # one UNIQUE index, not a separate constraint plus a plain index.
        sa.Column("license_plate", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=True),
        sa.Column("organization", sa.String(length=100), nullable=True),
        sa.Column(
            "vehicle_class",
            sa.Enum(*VEHICLE_CLASS_VALUES, name="govtvehicleclass"),
            nullable=False,
        ),
        sa.Column("cargo_capacity_tons", sa.Float(), nullable=False),
        sa.Column("depot_origin", sa.String(length=120), nullable=False),
        sa.Column("target_district", sa.String(length=120), nullable=False),
        sa.Column("synced_to_navner", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_fleet_vehicles_license_plate", "fleet_vehicles", ["license_plate"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_fleet_vehicles_license_plate", table_name="fleet_vehicles")
    op.drop_table("fleet_vehicles")
    sa.Enum(name="govtvehicleclass").drop(op.get_bind(), checkfirst=True)
