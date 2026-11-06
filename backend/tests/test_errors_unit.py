"""Uniform error format and English messages (no database needed for most)."""

from fastapi.testclient import TestClient

from app.errors import friendly_message
from app.main import create_app


def test_friendly_messages_are_not_raw_pydantic() -> None:
    assert friendly_message({"type": "missing"}) == "This field is required."
    assert friendly_message({"type": "value_error", "msg": "Value error, Enter a SKU."}) == "Enter a SKU."
    assert friendly_message({"type": "int_parsing"}) == "Enter a valid number."
    assert (
        friendly_message({"type": "string_too_long", "ctx": {"max_length": 5}}) == "Use at most 5 characters."
    )
    assert friendly_message({"type": "something_new"}) == "Invalid value."


def test_unknown_route_404_and_405_format() -> None:
    with TestClient(create_app(run_cleanup=False), raise_server_exceptions=False) as c:
        r = c.get("/api/does-not-exist")
        assert r.status_code == 404
        assert r.json() == {"error": {"code": "not_found", "message": "Not found.", "details": []}}
        r = c.delete("/api/auth/me")
        assert r.status_code == 405
        assert r.json()["error"]["code"] == "method_not_allowed"


def test_auth_required_without_cookie() -> None:
    with TestClient(create_app(run_cleanup=False), raise_server_exceptions=False) as c:
        for path in ("/api/auth/me", "/api/products", "/api/dashboard", "/api/reports/low-stock"):
            r = c.get(path)
            assert r.status_code == 401, path
            assert r.json()["error"]["code"] == "unauthenticated"


def test_invalid_json_400() -> None:
    with TestClient(create_app(run_cleanup=False), raise_server_exceptions=False) as c:
        r = c.post("/api/auth/sign-in", content=b'{"email":', headers={"Content-Type": "application/json"})
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "invalid_json"


def test_docs_disabled_in_production() -> None:
    with TestClient(create_app(run_cleanup=False), raise_server_exceptions=False) as c:
        assert c.get("/api/docs").status_code == 404
        assert c.get("/api/openapi.json").status_code == 404
