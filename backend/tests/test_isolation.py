"""Every resource type is invisible and untouchable from another account."""

import pytest

from tests.conftest import signup
from tests.helpers import category, ok, product, receive, write_off


@pytest.fixture
def two(make_client):
    a, b = make_client(), make_client()
    signup(a, "alice@example.com")
    signup(b, "bob@example.com")
    cat = category(a, "Alice cat")
    p = product(a, "ALICE-1", category_id=cat["id"])
    rc = receive(a, [(p["id"], 10, 2)])
    draft_rc = receive(a, [(p["id"], 1, 2)], post=False)
    wo = ok(write_off(a, [(p["id"], 1)]))
    draft_wo = write_off(a, [(p["id"], 1)], post=False)
    rv = ok(a.post(f"/api/write-offs/{wo['id']}/reverse"), 201)
    sc = ok(a.post("/api/stock-counts", json={}), 201)
    return (
        a,
        b,
        {
            "cat": cat,
            "p": p,
            "rc": rc,
            "draft_rc": draft_rc,
            "wo": wo,
            "draft_wo": draft_wo,
            "rv": rv,
            "sc": sc,
        },
    )


def _404(r) -> None:
    assert r.status_code == 404, f"{r.request.method} {r.request.url}: {r.status_code} {r.text}"
    assert r.json()["error"]["code"] == "not_found"


def test_categories_isolated(two) -> None:
    a, b, x = two
    assert ok(b.get("/api/categories")) == []
    _404(b.patch(f"/api/categories/{x['cat']['id']}", json={"name": "Hacked"}))
    _404(b.delete(f"/api/categories/{x['cat']['id']}"))
    # same name allowed in another account; foreign category can't be assigned to a product
    category(b, "Alice cat")
    r = b.post(
        "/api/products",
        json={
            "sku": "B",
            "name": "B",
            "unit": "pcs",
            "purchase_price": 1,
            "sale_price": 1,
            "category_id": x["cat"]["id"],
        },
    )
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "category_id"
    assert ok(a.get("/api/categories"))[0]["name"] == "Alice cat"


def test_products_isolated(two) -> None:
    _, b, x = two
    pid = x["p"]["id"]
    res = ok(b.get("/api/products", params={"status": "all"}))
    assert res["items"] == [] and res["counts"]["all"] == 0
    for r in (
        b.get(f"/api/products/{pid}"),
        b.get(f"/api/products/{pid}/movements"),
        b.put(
            f"/api/products/{pid}",
            json={"sku": "X", "name": "X", "unit": "pcs", "purchase_price": 1, "sale_price": 1},
        ),
        b.post(f"/api/products/{pid}/archive"),
        b.post(f"/api/products/{pid}/restore"),
    ):
        _404(r)
    assert "ALICE" not in b.get("/api/products/export.csv", params={"status": "all"}).text


def test_receipts_isolated(two) -> None:
    _, b, x = two
    assert ok(b.get("/api/receipts"))["items"] == []
    rid, did = x["rc"]["id"], x["draft_rc"]["id"]
    _404(b.get(f"/api/receipts/{rid}"))
    _404(b.put(f"/api/receipts/{did}", json={"lines": []}))
    _404(b.delete(f"/api/receipts/{did}"))
    _404(b.post(f"/api/receipts/{did}/post"))
    _404(b.post(f"/api/receipts/{rid}/reverse"))
    # foreign product in own document is rejected
    r = b.post("/api/receipts", json={"lines": [{"product_id": x["p"]["id"], "qty": 1, "price": 1}]})
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "lines.0.product_id"


def test_write_offs_and_reversals_isolated(two) -> None:
    _, b, x = two
    assert ok(b.get("/api/write-offs"))["items"] == []
    _404(b.get(f"/api/write-offs/{x['wo']['id']}"))
    _404(b.post(f"/api/write-offs/{x['draft_wo']['id']}/post"))
    _404(b.delete(f"/api/write-offs/{x['draft_wo']['id']}"))
    _404(b.post(f"/api/write-offs/{x['wo']['id']}/reverse"))
    _404(b.get(f"/api/reversals/{x['rv']['id']}"))
    # a receipt id is not reachable through the write-off endpoints of its own owner either
    _404(two[0].get(f"/api/write-offs/{x['rc']['id']}"))


def test_stock_counts_isolated(two) -> None:
    _, b, x = two
    sid = x["sc"]["id"]
    assert ok(b.get("/api/stock-counts"))["items"] == []
    _404(b.get(f"/api/stock-counts/{sid}"))
    _404(b.patch(f"/api/stock-counts/{sid}", json={"lines": []}))
    _404(b.post(f"/api/stock-counts/{sid}/post"))
    _404(b.delete(f"/api/stock-counts/{sid}"))
    r = b.post("/api/stock-counts", json={"category_id": x["cat"]["id"]})
    assert r.status_code == 422


def test_history_reports_dashboard_isolated(two) -> None:
    _, b, x = two
    assert ok(b.get("/api/movements"))["total"] == 0
    assert ok(b.get("/api/movements", params={"product_id": x["p"]["id"]}))["total"] == 0
    assert ok(b.get("/api/reports/stock-on-date"))["rows"] == []
    assert ok(b.get("/api/reports/movement", params={"from": "2000-01-01"}))["rows"] == []
    assert ok(b.get("/api/reports/low-stock"))["rows"] == []
    assert ok(b.get("/api/reports/write-offs-by-reason", params={"from": "2000-01-01"}))["total_value"] == 0
    assert ok(b.get("/api/reports/stock-value"))["total_value"] == 0
    d = ok(b.get("/api/dashboard"))
    assert d["kpis"]["active_products"] == 0 and d["recent"] == []


def test_document_numbering_is_per_account(two) -> None:
    _, b, _x = two
    p = product(b, "BOB-1")
    assert receive(b, [(p["id"], 1, 1)])["number"] == "RC-000001"
