"""Demo lifecycle: fresh seeded copy, 24 h expiry with automatic deletion, sign-out deletes."""

from sqlalchemy import text

from app.services.accounts import cleanup_expired
from tests.helpers import err, ok


def _counts(engine, user_id: int) -> dict:
    with engine.connect() as c:
        q = lambda t: c.execute(text(f"select count(*) from {t} where user_id = :u"), {"u": user_id}).scalar()  # noqa: E731
        return {t: q(t) for t in ("categories", "products", "documents", "movements")}


def test_demo_creates_seeded_isolated_copy(make_client, engine, fake_clock) -> None:
    a, b = make_client(), make_client()
    me = ok(a.post("/api/auth/demo"), 201)
    assert me["is_demo"] and me["email"].endswith("@demo.inventory.app")
    assert me["demo_expires_at"] == "2026-11-06T09:00:00Z"
    me_b = ok(b.post("/api/auth/demo"), 201)
    assert me_b["id"] != me["id"]
    ca, cb = _counts(engine, me["id"]), _counts(engine, me_b["id"])
    assert ca == cb and ca["categories"] == 9 and ca["products"] == 29 and ca["movements"] > 50

    prods = ok(a.get("/api/products", params={"status": "all"}))
    assert prods["counts"] == {"active": 27, "archived": 2, "all": 29, "low_stock": 6}
    by_sku = {p["sku"]: p for p in prods["items"]}
    # final stock levels match the approved mockup data set
    assert by_sku["FST-0012"]["stock"] == 42.5 and by_sku["LMB-0117"]["stock"] == 52.08
    assert by_sku["FST-0038"]["stock"] == 0 and by_sku["PNT-0198"]["archived"]
    receipts = ok(a.get("/api/receipts"))["items"]
    numbers = {d["number"]: d for d in receipts}
    assert (
        numbers["RC-000121"]["status"] == "reversed"
        and numbers["RC-000121"]["reversal"]["number"] == "RV-000007"
    )
    assert numbers["RC-000127"]["status"] == "draft"
    assert numbers["RV-000007"]["kind"] == "receipt_reversal"
    wos = {d["number"]: d for d in ok(a.get("/api/write-offs"))["items"]}
    assert wos["WO-000044"]["status"] == "reversed" and wos["WO-000048"]["status"] == "draft"
    counts = {d["number"]: d for d in ok(a.get("/api/stock-counts"))["items"]}
    assert counts["SC-000009"]["status"] == "draft" and counts["SC-000008"]["status"] == "posted"
    # no document is dated in the future
    for d in receipts:
        assert (d["posted_at"] or d["created_at"]) <= "2026-11-05T09:00:00Z"
    # all operations allowed; the two demos are independent
    pid = by_sku["FST-0012"]["id"]
    ok(a.post(f"/api/products/{pid}/archive"))
    assert ok(b.get("/api/products", params={"status": "archived"}))["counts"]["archived"] == 2
    err(b.get(f"/api/products/{pid}"), 404, "not_found")
    # reload keeps the demo (same cookie)
    assert ok(a.get("/api/auth/me"))["id"] == me["id"]


def test_demo_expires_after_24_hours_and_is_deleted(make_client, engine, fake_clock) -> None:
    c = make_client()
    me = ok(c.post("/api/auth/demo"), 201)
    fake_clock.advance(hours=23, minutes=59)
    ok(c.get("/api/dashboard"))
    fake_clock.advance(minutes=1)
    assert cleanup_expired_now(engine) == 1
    assert _counts(engine, me["id"]) == {"categories": 0, "products": 0, "documents": 0, "movements": 0}
    with engine.connect() as conn:
        assert conn.execute(text("select count(*) from users where id = :u"), {"u": me["id"]}).scalar() == 0
    err(c.get("/api/auth/me"), 401, "demo_expired")
    err(c.get("/api/products"), 401, "demo_expired")


def test_expired_demo_detected_on_request_before_cleanup(make_client, engine, fake_clock) -> None:
    c = make_client()
    me = ok(c.post("/api/auth/demo"), 201)
    fake_clock.advance(hours=24, seconds=1)
    err(c.get("/api/products"), 401, "demo_expired")
    assert _counts(engine, me["id"])["products"] == 0
    err(c.get("/api/auth/me"), 401, "demo_expired")


def cleanup_expired_now(engine) -> int:
    from app.db import get_sessionmaker

    with get_sessionmaker()() as db:
        return cleanup_expired(db)


def test_sign_out_deletes_demo(make_client, engine, fake_clock) -> None:
    c = make_client()
    me = ok(c.post("/api/auth/demo"), 201)
    assert ok(c.post("/api/auth/sign-out")) == {"was_demo": True}
    assert _counts(engine, me["id"])["products"] == 0
    err(c.get("/api/auth/me"), 401, "unauthenticated")
    me2 = ok(c.post("/api/auth/demo"), 201)  # Try demo always starts a new one
    assert me2["id"] != me["id"]


def test_sign_up_from_demo_starts_clean_and_deletes_demo(make_client, engine, fake_clock) -> None:
    c = make_client()
    demo = ok(c.post("/api/auth/demo"), 201)
    me = ok(c.post("/api/auth/sign-up", json={"email": "new@example.com", "password": "password-1"}), 201)
    assert not me["is_demo"]
    assert ok(c.get("/api/products", params={"status": "all"}))["counts"]["all"] == 0
    assert ok(c.get("/api/categories")) == []
    assert _counts(engine, demo["id"])["products"] == 0


def test_demo_rate_limit(make_client, fake_clock, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "demo_rate_limit_per_hour", 2)
    c = make_client(ip="203.0.113.7")
    ok(c.post("/api/auth/demo"), 201)
    ok(c.post("/api/auth/demo"), 201)
    e = err(c.post("/api/auth/demo"), 429, "rate_limited")
    assert e["retry_after"] == 3600
    ok(make_client(ip="203.0.113.8").post("/api/auth/demo"), 201)  # other client unaffected
    fake_clock.advance(hours=1, minutes=1)
    ok(c.post("/api/auth/demo"), 201)


def test_demo_dates_follow_visitor_timezone(make_client, fake_clock) -> None:
    c = make_client()
    c.headers["X-Timezone"] = "America/Los_Angeles"  # 09:00 UTC = 01:00 local → events pulled before now
    ok(c.post("/api/auth/demo"), 201)
    docs = ok(c.get("/api/receipts"))["items"]
    assert max(d["posted_at"] or d["created_at"] for d in docs) < "2026-11-05T09:00:00Z"
    assert ok(c.get("/api/products", params={"status": "all"}))["counts"]["all"] == 29


def test_cleanup_ignores_regular_accounts(make_client, engine, fake_clock) -> None:
    from tests.conftest import signup

    c = make_client()
    signup(c, "keep@example.com")
    fake_clock.advance(days=40)
    assert cleanup_expired_now(engine) == 0
    with engine.connect() as conn:
        assert conn.execute(text("select count(*) from users where email='keep@example.com'")).scalar() == 1
