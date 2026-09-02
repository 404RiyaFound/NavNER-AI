"""baseline — adopt Alembic against an existing schema

Deliberately a no-op.

Alembic is being introduced to a project whose tables were created by
``Base.metadata.create_all`` and which therefore already exist in every
developer's database and in any deployment. Autogenerating a full CREATE TABLE
baseline would fail on all of them.

This revision instead marks "the schema as it stood before Alembic". Existing
databases can be stamped or upgraded to it with no effect; real changes start at
the next revision, and every one of them is written to be safe on a database
that ``create_all`` has already touched.

Revision ID: 0001_baseline
Revises:
"""

from __future__ import annotations

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
