"""Application settings loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configuration pulled from .env or environment variables."""

    DATABASE_URL: str = (
        "postgresql+psycopg://navner:navner_secret@localhost:5432/navner_ai"
    )
    UPLOAD_DIR: str = "./uploads"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:5174,http://localhost:3000,http://localhost:8081"
    SNS_TOPIC_ARN: str | None = None

    # ── Telemetry simulation (demo / local development) ───────────────────
    # Off by default: enabling it writes vehicle positions, so it must never
    # start implicitly against a database holding real telemetry.
    SIMULATE_TELEMETRY: bool = False
    SIM_INTERVAL_SECONDS: int = 2
    SIM_SPEED_KMPH: float = 45.0
    SIM_VEHICLE_LIMIT: int = 3
    # Broadcast every tick, but persist a Telemetry row every Nth tick.
    SIM_TELEMETRY_EVERY: int = 5
    SIM_ROUTE_CACHE: str = "./.cache/osrm_corridor.json"
    OSRM_BASE_URL: str = "https://router.project-osrm.org"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
