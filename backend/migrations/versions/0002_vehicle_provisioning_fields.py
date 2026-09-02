"""add government provisioning fields to vehicles (issue #65 §3.1)

Adds vehicle_class, cargo_capacity_tons, depot_origin and target_district so the
fleet-manager portal can register vehicles with the details a government
dispatcher supplies.

Every step is guarded by an inspector check. ``Base.metadata.create_all`` still
runs at startup, so on a *fresh* database these columns and the enum type already
exist by the time migrations run — an unguarded ADD COLUMN would fail there while
being exactly right on an existing database. Guarding makes the revision correct
in both directions, which is the property that matters while create_all and
Alembic coexist.

Revision ID: 0002_vehicle_provisioning
Revises: 0001_baseline
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_vehicle_provisioning"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

VEHICLE_CLASS_VALUES = (
    "HEAVY_TRUCK",
    "PICKUP_4X4",
    "AMBULANCE",
    "NDRF_BOAT",
    "UTILITY",
)

NEW_COLUMNS = {
    "vehicle_class": sa.Column(
        "vehicle_class",
        sa.Enum(*VEHICLE_CLASS_VALUES, name="vehicleclass"),
        nullable=True,
    ),
    "cargo_capacity_tons": sa.Column("cargo_capacity_tons", sa.Float(), nullable=True),
    "depot_origin": sa.Column("depot_origin", sa.String(length=120), nullable=True),
    "target_district": sa.Column("target_district", sa.String(length=120), nullable=True),
}


def _existing_columns(inspector) -> set[str]:
    return {c["name"] for c in inspector.get_columns("vehicles")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("vehicles"):
        # Nothing to alter — create_all will build the table from the model,
        # which already carries these columns.
        return

    # The enum type may already exist, created either by create_all or by a
    # prior partial run. checkfirst keeps this idempotent.
    sa.Enum(*VEHICLE_CLASS_VALUES, name="vehicleclass").create(bind, checkfirst=True)

    present = _existing_columns(inspector)
    for name, column in NEW_COLUMNS.items():
        if name not in present:
            op.add_column("vehicles", column)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("vehicles"):
        return

    present = _existing_columns(inspector)
    for name in reversed(list(NEW_COLUMNS)):
        if name in present:
            op.drop_column("vehicles", name)

    sa.Enum(name="vehicleclass").drop(bind, checkfirst=True)
