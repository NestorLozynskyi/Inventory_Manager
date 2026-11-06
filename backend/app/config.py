from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://inventory:inventory@localhost:5432/inventory",
        description="SQLAlchemy URL (postgresql+psycopg://user:pass@host:port/db)",
    )
    app_env: str = Field(default="production", description="development | production")
    log_level: str = Field(default="INFO")

    # Sessions / cookies
    cookie_secure: bool = Field(default=False, description="Send the session cookie only over HTTPS")
    session_days: int = Field(default=30)

    # Demo workspaces
    demo_lifetime_hours: int = Field(default=24)
    demo_rate_limit_per_hour: int = Field(default=10, description="New demos per client IP per hour")
    demo_global_limit_per_hour: int = Field(default=500, description="New demos per hour overall")
    cleanup_interval_seconds: int = Field(default=60)

    # Sign-in brute-force protection
    login_max_failures_per_email: int = Field(default=10)
    login_max_failures_per_ip: int = Field(default=30)
    login_window_minutes: int = Field(default=15)

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
