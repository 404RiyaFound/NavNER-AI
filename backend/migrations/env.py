"""Alembic environment.

The URL comes from app.config.settings rather than alembic.ini, so there is one
source of truth for the connection string and no credentials in a tracked file.
The app uses an async driver; migrations run synchronously, so the +psycopg
async prefix is normalised to the sync form here.
"""

from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.models import Base  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def include_object(object_, name, type_, reflected, compare_to):
    """Limit autogenerate to tables this application actually owns.

    The PostGIS extension installs a large amount of its own schema —
    spatial_ref_sys in public, plus everything under the tiger and topology
    schemas (direction_lookup, layer, and dozens more). None of it is in our
    models, so an unfiltered --autogenerate proposes dropping all of it, which
    both pollutes hand-written revisions and makes an automated drift check
    impossible.

    Filtering on membership of Base.metadata rather than an explicit denylist
    means new PostGIS objects, or a new extension, never reintroduce the noise.
    The trade-off is that dropping one of our own tables from the models is not
    flagged as drift — an acceptable blind spot, since removing a table is a
    deliberate act that comes with its own migration.
    """
    if type_ == "table" and reflected and name not in target_metadata.tables:
        return False
    return True


def _sync_url() -> str:
    """SQLAlchemy URL with the async driver stripped for migration use."""
    return settings.DATABASE_URL.replace("+psycopg_async", "+psycopg").replace(
        "postgresql+asyncpg", "postgresql+psycopg"
    )


def run_migrations_offline() -> None:
    context.configure(
        url=_sync_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _sync_url()

    connectable = engine_from_config(
        section, prefix="sqlalchemy.", poolclass=pool.NullPool
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
