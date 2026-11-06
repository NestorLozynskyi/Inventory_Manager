"""Test fixtures.

Integration tests need a real PostgreSQL given by TEST_DATABASE_URL. The schema is recreated with the
Alembic migrations once per session; every test starts from empty tables (TRUNCATE), so tests can use
real commits and several concurrent connections (needed for the concurrency tests).
"""

import os
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text

from app import clock

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLES = (
    "movements, document_lines, doc_counters, documents, products, categories, sessions, "
    "expired_demo_sessions, auth_events, users"
)


def _test_db_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set; integration test skipped")
    return url


def alembic_config(connection) -> Config:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.attributes["connection"] = connection
    cfg.attributes["configure_logger"] = False
    return cfg


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    url = _test_db_url()
    os.environ["DATABASE_URL"] = url
    from app import db
    from app.config import get_settings

    get_settings.cache_clear()
    db.get_engine.cache_clear()
    db.get_sessionmaker.cache_clear()
    eng = create_engine(url)
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        command.upgrade(alembic_config(conn), "head")
    yield eng
    eng.dispose()


@pytest.fixture(autouse=True)
def _clean(request) -> Iterator[None]:
    if (
        "engine" in request.fixturenames
        or "client" in request.fixturenames
        or "make_client" in request.fixturenames
    ):
        eng = request.getfixturevalue("engine")
        with eng.begin() as conn:
            conn.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    yield
    clock.set_now(None)


class FakeClock:
    def __init__(self, start: datetime) -> None:
        self.t = start

    def __call__(self) -> datetime:
        return self.t

    def advance(self, **kw) -> None:
        self.t += timedelta(**kw)


@pytest.fixture
def fake_clock() -> Iterator[FakeClock]:
    c = FakeClock(datetime(2026, 11, 5, 9, 0, tzinfo=UTC))
    clock.set_now(c)
    yield c
    clock.set_now(None)


@pytest.fixture
def make_client(engine) -> Iterator[Callable[..., TestClient]]:
    from app.main import create_app

    app = create_app(run_cleanup=False)
    clients: list[TestClient] = []

    def make(ip: str = "testclient") -> TestClient:
        c = TestClient(app, raise_server_exceptions=False, client=(ip, 50000))
        c.headers["X-Timezone"] = "UTC"
        c.__enter__()
        clients.append(c)
        return c

    yield make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


_n = 0


def signup(c: TestClient, email: str | None = None, password: str = "correct-horse-1") -> dict:
    global _n
    _n += 1
    email = email or f"user{_n}@example.com"
    r = c.post("/api/auth/sign-up", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def user(make_client) -> TestClient:
    c = make_client()
    signup(c)
    return c
