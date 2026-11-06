from app.config import get_settings
from tests.conftest import signup
from tests.helpers import err, ok


def test_sign_up_sets_session_and_me(client) -> None:
    me = signup(client, "Alex@Example.com")
    assert me["email"] == "alex@example.com"
    assert me["is_demo"] is False and me["demo_expires_at"] is None and me["currency"] == "USD"
    cookie = client.cookies.get("im_session")
    assert cookie
    assert ok(client.get("/api/auth/me"))["email"] == "alex@example.com"


def test_session_cookie_flags(client) -> None:
    r = client.post("/api/auth/sign-up", json={"email": "a@b.co", "password": "password1"})
    sc = r.headers["set-cookie"].lower()
    assert "httponly" in sc and "samesite=lax" in sc and "path=/" in sc


def test_sign_up_validation_messages(client) -> None:
    e = err(
        client.post("/api/auth/sign-up", json={"email": "nope", "password": "short"}), 422, "validation_error"
    )
    msgs = {d["field"]: d["message"] for d in e["details"]}
    assert msgs == {
        "email": "Enter a valid email address, like name@company.com.",
        "password": "Use at least 8 characters.",
    }


def test_email_taken(make_client) -> None:
    signup(make_client(), "dup@example.com")
    e = err(
        make_client().post("/api/auth/sign-up", json={"email": "DUP@example.com", "password": "password1"}),
        409,
        "email_taken",
    )
    assert e["details"][0]["field"] == "email"


def test_sign_in_and_wrong_credentials(make_client) -> None:
    signup(make_client(), "in@example.com", "password-123")
    c = make_client()
    err(
        c.post("/api/auth/sign-in", json={"email": "in@example.com", "password": "wrong-pass"}),
        401,
        "invalid_credentials",
    )
    err(
        c.post("/api/auth/sign-in", json={"email": "ghost@example.com", "password": "whatever1"}),
        401,
        "invalid_credentials",
    )
    ok(c.post("/api/auth/sign-in", json={"email": "IN@example.com", "password": "password-123"}))
    assert ok(c.get("/api/auth/me"))["email"] == "in@example.com"


def test_sign_in_brute_force_lock(make_client) -> None:
    signup(make_client(), "bf@example.com", "password-123")
    c = make_client()
    for _ in range(get_settings().login_max_failures_per_email):
        err(
            c.post("/api/auth/sign-in", json={"email": "bf@example.com", "password": "bad-pass-1"}),
            401,
            "invalid_credentials",
        )
    e = err(
        c.post("/api/auth/sign-in", json={"email": "bf@example.com", "password": "password-123"}),
        429,
        "too_many_attempts",
    )
    assert e["retry_after"] > 0


def test_brute_force_window_expires(make_client, fake_clock) -> None:
    signup(make_client(), "bf2@example.com", "password-123")
    c = make_client()
    for _ in range(get_settings().login_max_failures_per_email):
        c.post("/api/auth/sign-in", json={"email": "bf2@example.com", "password": "bad-pass-1"})
    err(
        c.post("/api/auth/sign-in", json={"email": "bf2@example.com", "password": "password-123"}),
        429,
        "too_many_attempts",
    )
    fake_clock.advance(minutes=16)
    ok(c.post("/api/auth/sign-in", json={"email": "bf2@example.com", "password": "password-123"}))


def test_sign_out_regular_keeps_account(make_client) -> None:
    c = make_client()
    signup(c, "out@example.com", "password-123")
    assert ok(c.post("/api/auth/sign-out")) == {"was_demo": False}
    err(c.get("/api/auth/me"), 401, "unauthenticated")
    ok(make_client().post("/api/auth/sign-in", json={"email": "out@example.com", "password": "password-123"}))


def test_password_is_hashed(client, engine) -> None:
    from sqlalchemy import text

    signup(client, "hash@example.com", "password-123")
    with engine.connect() as conn:
        h = conn.execute(text("select password_hash from users where email='hash@example.com'")).scalar_one()
    assert h.startswith("$argon2") and "password-123" not in h
