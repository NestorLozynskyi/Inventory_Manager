from app.config import Settings


def test_settings_from_env(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://a:b@db:5432/x")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    s = Settings(_env_file=None)
    assert s.database_url == "postgresql+psycopg://a:b@db:5432/x"
    assert s.is_development
    assert s.cookie_secure is True
    assert s.demo_lifetime_hours == 24
