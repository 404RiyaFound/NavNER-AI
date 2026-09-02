"""Async SQLAlchemy engine and session factory for the Fleet Manager database.

Deliberately separate from app.database — see the GOVT_DATABASE_URL comment in
app.config for why this is a second database rather than a second schema.
"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

govt_engine = create_async_engine(settings.GOVT_DATABASE_URL, echo=False, future=True)

govt_async_session = async_sessionmaker(
    govt_engine, class_=AsyncSession, expire_on_commit=False
)


async def get_govt_db() -> AsyncSession:
    """FastAPI dependency that yields a session against the Fleet Manager DB."""
    async with govt_async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
