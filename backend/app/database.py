from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)

# Read-only engine for the user-facing SQL query endpoint.
# Uses a separate connection URL if configured (e.g. a DB user with only SELECT
# privileges), otherwise falls back to the main URL with read-only execution
# options and a statement timeout.
_ro_url = settings.database_url_readonly or settings.database_url
ro_engine = create_async_engine(
    _ro_url,
    echo=False,
    execution_options={
        "postgresql_readonly": True,
        "postgresql_deferrable": True,
    },
)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session
