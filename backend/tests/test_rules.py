"""Business rules: stock, immutability, weighted average cost, reversals, stock counts, reports."""

import threading
from datetime import timedelta

import pytest

from tests.helpers import category, err, get_product, ok, product, receive, stock, write_off

# ---------------------------------------------------------------- catalogue


def test_sku_unique_per_account_case_insensitive(user, make_client) -> None:
    from tests.conftest import signup

    product(user, "ABC-1")
    e = err(
        user.post(
            "/api/products",
            json={"sku": "abc-1", "name": "X", "unit": "pcs", "purchase_price": 1, "sale_price": 2},
        ),
        409,
        "duplicate_sku",
    )
    assert e["details"][0]["field"] == "sku"
    other = product(user, "ABC-2")
    err(
        user.put(
            f"/api/products/{other['id']}",
            json={"sku": "ABC-1", "name": "X", "unit": "pcs", "purchase_price": 1, "sale_price": 2},
        ),
        409,
        "duplicate_sku",
    )
    c2 = make_client()
    signup(c2)
    product(c2, "ABC-1")  # same SKU in another account is fine


def test_product_validation_messages(user) -> None:
    e = err(
        user.post(
            "/api/products",
            json={
                "sku": "",
                "name": "",
                "unit": "box",
                "purchase_price": "-4.50",
                "sale_price": "12,5O",
                "min_stock": "1.5",
            },
        ),
        422,
        "validation_error",
    )
    msgs = {d["field"]: d["message"] for d in e["details"]}
    assert msgs["sku"] == "Enter a SKU."
    assert msgs["name"] == "Enter a product name."
    assert msgs["unit"] == "Select a unit of measure."
    assert msgs["purchase_price"] == "The price can't be negative."
    assert msgs["sale_price"] == "Enter a valid amount, like 12.50."


def test_whole_units_reject_fractions(user) -> None:
    e = err(
        user.post(
            "/api/products",
            json={
                "sku": "P",
                "name": "P",
                "unit": "pcs",
                "purchase_price": 1,
                "sale_price": 1,
                "min_stock": "2.5",
            },
        ),
        422,
        "validation_error",
    )
    assert e["details"][0]["field"] == "min_stock"
    p = product(user, "W", unit="pcs")
    d = (
        ok(
            user.post("/api/receipts", json={"lines": [{"product_id": p["id"], "qty": "1.5", "price": 1}]}),
            422,
        )
        if False
        else None
    )
    r = user.post("/api/receipts", json={"lines": [{"product_id": p["id"], "qty": "1.5", "price": 1}]})
    e = err(r, 422, "validation_error")
    assert e["details"][0] == {
        "field": "lines.0.qty",
        "message": "Enter a whole number — pcs can't be fractional.",
        "type": "invalid_qty",
    }
    kg = product(user, "K", unit="kg")
    ok(
        user.post("/api/receipts", json={"lines": [{"product_id": kg["id"], "qty": "1.125", "price": 1}]}),
        201,
    )
    e = err(
        user.post("/api/receipts", json={"lines": [{"product_id": kg["id"], "qty": "1.1255", "price": 1}]}),
        422,
        "validation_error",
    )
    assert e["details"][0]["message"] == "Use at most 3 decimal places."
    assert d is None


def test_unit_locked_after_movements(user) -> None:
    p = product(user, "U", unit="kg")
    body = {"sku": "U", "name": "U", "unit": "pcs", "purchase_price": 1, "sale_price": 1}
    ok(user.put(f"/api/products/{p['id']}", json=body))  # no movements yet → allowed
    receive(user, [(p["id"], 2, 1)])
    body["unit"] = "kg"
    e = err(user.put(f"/api/products/{p['id']}", json=body), 422, "validation_error")
    assert e["details"][0]["field"] == "unit"


def test_category_delete_only_when_unused(user) -> None:
    used = category(user, "Used")
    free = category(user, "Free")
    p = product(user, "C1", category_id=used["id"])
    ok(user.post(f"/api/products/{p['id']}/archive"))
    e = err(user.delete(f"/api/categories/{used['id']}"), 409, "category_in_use")
    assert e["product_count"] == 1  # archived products still use it
    assert user.delete(f"/api/categories/{free['id']}").status_code == 204
    cats = ok(user.get("/api/categories"))
    assert [(c["name"], c["product_count"], c["active_product_count"]) for c in cats] == [("Used", 1, 0)]


def test_category_names_unique(user) -> None:
    category(user, "Paint")
    e = err(user.post("/api/categories", json={"name": " paint "}), 409, "duplicate_name")
    assert e["details"][0]["field"] == "name"
    other = category(user, "Glue")
    err(user.patch(f"/api/categories/{other['id']}", json={"name": "PAINT"}), 409, "duplicate_name")
    assert (
        ok(user.patch(f"/api/categories/{other['id']}", json={"name": "Glue & tape"}))["name"]
        == "Glue & tape"
    )


def test_archived_products_not_postable_but_restorable(user) -> None:
    p = product(user, "A1")
    receive(user, [(p["id"], 5, 2)])
    draft = receive(user, [(p["id"], 1, 2)], post=False)
    ok(user.post(f"/api/products/{p['id']}/archive"))
    assert get_product(user, p["id"])["archived"] is True
    e = err(user.post(f"/api/receipts/{draft['id']}/post"), 409, "product_archived")
    assert e["details"][0]["field"] == "lines.0.product_id"
    ok(user.post(f"/api/products/{p['id']}/restore"))
    ok(user.post(f"/api/receipts/{draft['id']}/post"))
    assert stock(user, p["id"]) == 6


def test_product_list_filters_and_csv(user) -> None:
    cat = category(user, "Fasteners")
    a = product(user, "FST-1", name="Nails", category_id=cat["id"], min_stock=10)
    product(user, "OTH-1", name="Hammer")
    receive(user, [(a["id"], 5, 1)])
    res = ok(user.get("/api/products", params={"low_stock": "true"}))
    assert [p["sku"] for p in res["items"]] == ["FST-1"]
    assert res["counts"] == {"active": 2, "archived": 0, "all": 2, "low_stock": 1}
    assert [p["sku"] for p in ok(user.get("/api/products", params={"search": "ham"}))["items"]] == ["OTH-1"]
    assert [p["sku"] for p in ok(user.get("/api/products", params={"category_id": "none"}))["items"]] == [
        "OTH-1"
    ]
    r = user.get("/api/products/export.csv", params={"sort": "sku"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="products-' in r.headers["content-disposition"]
    lines = r.content.decode("utf-8-sig").splitlines()
    assert lines[0].startswith("SKU,Name,Category,Unit,Stock")
    assert lines[1].startswith("FST-1,Nails,Fasteners,pcs,5,10,1.00,5.00")


# ---------------------------------------------------------------- documents


def test_drafts_do_not_affect_stock_and_posted_are_immutable(user) -> None:
    p = product(user, "D1")
    d = receive(user, [(p["id"], 3, 2)], post=False)
    assert d["status"] == "draft" and d["number"] == "RC-000001" and d["posted_at"] is None
    assert stock(user, p["id"]) == 0
    posted = ok(user.post(f"/api/receipts/{d['id']}/post"))
    assert posted["status"] == "posted" and posted["posted_at"]
    assert stock(user, p["id"]) == 3
    body = {"lines": [{"product_id": p["id"], "qty": 9, "price": 2}]}
    err(user.put(f"/api/receipts/{d['id']}", json=body), 409, "document_not_draft")
    err(user.delete(f"/api/receipts/{d['id']}"), 409, "document_not_draft")
    err(user.post(f"/api/receipts/{d['id']}/post"), 409, "document_not_draft")
    assert stock(user, p["id"]) == 3


def test_draft_edit_and_delete(user) -> None:
    p = product(user, "D2")
    d = ok(user.post("/api/receipts", json={"supplier": "ACME", "lines": [{"product_id": None}]}), 201)
    assert d["lines"][0]["product"] is None  # incomplete drafts are allowed
    d = ok(
        user.put(
            f"/api/receipts/{d['id']}",
            json={"supplier": "ACME", "note": "n", "lines": [{"product_id": p["id"], "qty": 2, "price": 3}]},
        )
    )
    assert d["total"] == 6 and d["line_count"] == 1
    assert user.delete(f"/api/receipts/{d['id']}").status_code == 204
    err(user.get(f"/api/receipts/{d['id']}"), 404, "not_found")


def test_post_validation_lists_line_errors(user) -> None:
    p = product(user, "V1")
    d = ok(
        user.post(
            "/api/receipts",
            json={
                "lines": [
                    {"product_id": p["id"], "qty": 100, "price": 1.85},
                    {"product_id": None, "qty": 24},
                    {"product_id": p["id"], "qty": 0, "price": 0.95},
                ]
            },
        ),
        201,
    )
    e = err(user.post(f"/api/receipts/{d['id']}/post"), 422, "validation_error")
    assert {(x["field"], x["message"]) for x in e["details"]} == {
        ("lines.1.product_id", "Choose a product."),
        ("lines.2.qty", "Enter a quantity greater than 0."),
    }
    empty = ok(user.post("/api/receipts", json={"lines": []}), 201)
    err(user.post(f"/api/receipts/{empty['id']}/post"), 422, "validation_error")


def test_write_off_insufficient_stock_lists_all_shortages(user) -> None:
    a = product(user, "S1")
    b = product(user, "S2", unit="kg")
    receive(user, [(a["id"], 5, 1), (b["id"], "2.5", 1)])
    r = write_off(user, [(a["id"], 3), (b["id"], 3), (a["id"], 3)])
    e = err(r, 409, "insufficient_stock")
    short = {s["sku"]: (s["required"], s["available"]) for s in e["shortages"]}
    assert short == {"S1": (6.0, 5.0), "S2": (3.0, 2.5)}
    assert stock(user, a["id"]) == 5 and stock(user, b["id"]) == 2.5
    ok(write_off(user, [(a["id"], 5), (b["id"], "2.5")]))
    assert stock(user, a["id"]) == 0 and stock(user, b["id"]) == 0


def test_write_off_requires_valid_reason(user) -> None:
    e = err(user.post("/api/write-offs", json={"reason": "Gift", "lines": []}), 422, "validation_error")
    assert e["details"][0] == {"field": "reason", "message": "Choose a reason.", "type": "value_error"}


def test_weighted_average_cost_and_write_off_valuation(user) -> None:
    p = product(user, "AVG", price="9.99")
    assert get_product(user, p["id"])["avg_cost"] == 9.99  # before first receipt: purchase price
    receive(user, [(p["id"], 10, 4)])
    receive(user, [(p["id"], 30, 8)])
    pr = get_product(user, p["id"])
    assert pr["avg_cost"] == 7.0 and pr["stock_value"] == 280.0  # (10*4 + 30*8) / 40
    wo = ok(write_off(user, [(p["id"], 5)]))
    assert wo["lines"][0]["unit_cost"] == 7.0 and wo["total"] == 35.0
    receive(user, [(p["id"], 5, 14)])  # (35*7 + 5*14) / 40 = 7.875
    assert get_product(user, p["id"])["avg_cost"] == 7.875
    # write-off cost stays as at posting
    assert ok(user.get(f"/api/write-offs/{wo['id']}"))["lines"][0]["unit_cost"] == 7.0


def test_receipt_reversal_restores_average_and_links_documents(user) -> None:
    p = product(user, "RV")
    receive(user, [(p["id"], 10, 5)])
    wrong = receive(user, [(p["id"], 10, 9)], supplier="ElectroParts")
    assert get_product(user, p["id"])["avg_cost"] == 7.0
    rv = ok(user.post(f"/api/receipts/{wrong['id']}/reverse", json={"note": "Wrong price"}), 201)
    assert rv["kind"] == "receipt_reversal" and rv["number"] == "RV-000001" and rv["status"] == "posted"
    assert rv["reverses"]["number"] == wrong["number"] and rv["supplier"] == "ElectroParts"
    assert rv["total"] == wrong["total"]
    orig = ok(user.get(f"/api/receipts/{wrong['id']}"))
    assert orig["status"] == "reversed" and orig["reversal"]["number"] == "RV-000001"
    pr = get_product(user, p["id"])
    assert pr["stock"] == 10 and pr["avg_cost"] == 5.0
    err(user.post(f"/api/receipts/{wrong['id']}/reverse"), 409, "already_reversed")
    assert ok(user.get(f"/api/reversals/{rv['id']}"))["id"] == rv["id"]
    lst = ok(user.get("/api/receipts", params={"status": "reversal"}))["items"]
    assert [d["number"] for d in lst] == ["RV-000001"]
    hist = ok(user.get("/api/movements", params={"type": "reversal"}))["items"]
    assert hist[0]["qty_change"] == -10 and hist[0]["balance_after"] == 10


def test_receipt_reversal_refused_when_stock_was_used(user) -> None:
    p = product(user, "RR")
    rc = receive(user, [(p["id"], 10, 5)])
    ok(write_off(user, [(p["id"], 4)]))
    e = err(user.post(f"/api/receipts/{rc['id']}/reverse"), 409, "insufficient_stock")
    assert e["shortages"][0]["required"] == 10 and e["shortages"][0]["available"] == 6
    assert ok(user.get(f"/api/receipts/{rc['id']}"))["status"] == "posted"
    assert stock(user, p["id"]) == 6


def test_write_off_reversal_returns_stock_at_original_cost(user) -> None:
    p = product(user, "WR")
    receive(user, [(p["id"], 10, 6)])
    wo = ok(write_off(user, [(p["id"], 4)], reason="Lost / Theft"))
    receive(user, [(p["id"], 6, 10)])  # avg = (6*6 + 6*10)/12 = 8
    assert get_product(user, p["id"])["avg_cost"] == 8.0
    rv = ok(user.post(f"/api/write-offs/{wo['id']}/reverse"), 201)
    assert rv["kind"] == "write_off_reversal" and rv["reason"] == "Lost / Theft"
    pr = get_product(user, p["id"])
    assert pr["stock"] == 16 and pr["avg_cost"] == 7.5  # (12*8 + 4*6)/16
    report = ok(user.get("/api/reports/write-offs-by-reason"))
    assert report["total_value"] == 0 and report["reversed_numbers"] == [wo["number"]]


def test_reversing_drafts_or_reversals_is_refused(user) -> None:
    p = product(user, "RD")
    d = receive(user, [(p["id"], 1, 1)], post=False)
    err(user.post(f"/api/receipts/{d['id']}/reverse"), 409, "document_not_draft")
    rc = receive(user, [(p["id"], 1, 1)])
    rv = ok(user.post(f"/api/receipts/{rc['id']}/reverse"), 201)
    err(user.post(f"/api/receipts/{rv['id']}/reverse"), 404, "not_found")


def _post_in_threads(make_client, cookies, paths: list[str]) -> list[int]:
    barrier = threading.Barrier(len(paths))
    results: list[int] = [0] * len(paths)

    def run(i: int, path: str) -> None:
        c = make_client()
        c.cookies.update(cookies)
        barrier.wait()
        results[i] = c.post(path).status_code

    threads = [threading.Thread(target=run, args=(i, p)) for i, p in enumerate(paths)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def test_concurrent_write_offs_never_go_negative(user, make_client) -> None:
    p = product(user, "CC")
    receive(user, [(p["id"], 10, 1)])
    drafts = [write_off(user, [(p["id"], 6)], post=False) for _ in range(4)]
    codes = _post_in_threads(make_client, user.cookies, [f"/api/write-offs/{d['id']}/post" for d in drafts])
    assert sorted(codes) == [200, 409, 409, 409]
    assert stock(user, p["id"]) == 4


def test_concurrent_double_post_and_double_reverse(user, make_client) -> None:
    p = product(user, "DP")
    d = receive(user, [(p["id"], 5, 1)], post=False)
    codes = _post_in_threads(make_client, user.cookies, [f"/api/receipts/{d['id']}/post"] * 3)
    assert sorted(codes) == [200, 409, 409]
    assert stock(user, p["id"]) == 5
    codes = _post_in_threads(make_client, user.cookies, [f"/api/receipts/{d['id']}/reverse"] * 3)
    assert sorted(codes) == [201, 409, 409]
    assert stock(user, p["id"]) == 0


def test_concurrent_reversal_and_write_off(user, make_client) -> None:
    p = product(user, "RW")
    rc = receive(user, [(p["id"], 10, 1)])
    wo = write_off(user, [(p["id"], 10)], post=False)
    codes = _post_in_threads(
        make_client, user.cookies, [f"/api/receipts/{rc['id']}/reverse", f"/api/write-offs/{wo['id']}/post"]
    )
    assert sorted(codes) in ([201, 409], [200, 409])
    assert stock(user, p["id"]) == 0


# ---------------------------------------------------------------- stock counts


def test_stock_count_live_book_qty_and_posting(user) -> None:
    cat = category(user, "Counted")
    a = product(user, "SC-A", unit="kg", category_id=cat["id"], price="2.00")
    b = product(user, "SC-B", category_id=cat["id"])
    c = product(user, "SC-C", category_id=cat["id"])
    other = product(user, "OUT")
    receive(user, [(a["id"], 10, 2), (b["id"], 5, 3), (c["id"], 7, 1), (other["id"], 1, 1)])
    sc = ok(user.post("/api/stock-counts", json={"category_id": cat["id"]}), 201)
    assert sc["number"] == "SC-000001" and sc["scope"] == "category" and sc["line_count"] == 3
    lines = {ln["product"]["sku"]: ln for ln in sc["lines"]}
    sc = ok(
        user.patch(
            f"/api/stock-counts/{sc['id']}",
            json={
                "lines": [
                    {"id": lines["SC-A"]["id"], "actual_qty": "9.5"},
                    {"id": lines["SC-B"]["id"], "actual_qty": 5},
                ]
            },
        )
    )
    # stock changes while the draft is open → book qty is live
    receive(user, [(a["id"], 2, 2)])
    draft = {ln["product"]["sku"]: ln for ln in ok(user.get(f"/api/stock-counts/{sc['id']}"))["lines"]}
    assert draft["SC-A"]["book_qty"] == 12 and draft["SC-A"]["difference"] == -2.5
    assert draft["SC-A"]["value"] == -5.0
    assert draft["SC-C"]["actual_qty"] is None and draft["SC-C"]["difference"] is None
    posted = ok(user.post(f"/api/stock-counts/{sc['id']}/post"))
    assert posted["status"] == "posted" and posted["counted"] == 2 and posted["shortage_count"] == 1
    assert posted["shortage_value"] == -5.0 and posted["surplus_count"] == 0
    assert stock(user, a["id"]) == 9.5 and stock(user, b["id"]) == 5 and stock(user, c["id"]) == 7
    # after posting the line keeps book qty at posting even if stock changes later
    receive(user, [(a["id"], 1, 2)])
    pl = {ln["product"]["sku"]: ln for ln in ok(user.get(f"/api/stock-counts/{sc['id']}"))["lines"]}
    assert pl["SC-A"]["book_qty"] == 12 and pl["SC-A"]["difference"] == -2.5
    adj = ok(user.get("/api/movements", params={"type": "stock_count"}))["items"]
    assert len(adj) == 1 and adj[0]["qty_change"] == -2.5 and adj[0]["balance_after"] == 9.5
    err(user.patch(f"/api/stock-counts/{sc['id']}", json={"lines": []}), 409, "document_not_draft")
    err(user.post(f"/api/stock-counts/{sc['id']}/post"), 409, "document_not_draft")


def test_stock_count_surplus_and_validation(user) -> None:
    p = product(user, "SUR", price="4.00")
    sc = ok(user.post("/api/stock-counts", json={}), 201)
    assert sc["scope"] == "all"
    line = sc["lines"][0]
    err(user.post(f"/api/stock-counts/{sc['id']}/post"), 422, "validation_error")  # nothing counted
    e = err(
        user.patch(
            f"/api/stock-counts/{sc['id']}", json={"lines": [{"id": line["id"], "actual_qty": "1.5"}]}
        ),
        422,
        "validation_error",
    )
    assert e["details"][0]["field"] == "lines.0.actual_qty"
    ok(user.patch(f"/api/stock-counts/{sc['id']}", json={"lines": [{"id": line["id"], "actual_qty": 3}]}))
    posted = ok(user.post(f"/api/stock-counts/{sc['id']}/post"))
    assert posted["surplus_value"] == 12.0 and posted["net_value"] == 12.0
    pr = get_product(user, p["id"])
    assert pr["stock"] == 3 and pr["avg_cost"] == 4.0


def test_stock_count_scope_without_products(user) -> None:
    empty = category(user, "Empty")
    e = err(user.post("/api/stock-counts", json={"category_id": empty["id"]}), 422, "validation_error")
    assert e["details"][0]["field"] == "category_id"


# ---------------------------------------------------------------- reports


def test_reports_on_date_and_period_use_cost_at_the_time(user, fake_clock) -> None:
    cat = category(user, "R")
    p = product(user, "REP", category_id=cat["id"], min_stock=5)
    receive(user, [(p["id"], 10, 4)])  # Nov 5: 10 @ 4
    fake_clock.advance(days=2)
    receive(user, [(p["id"], 10, 6)])  # Nov 7: 20 @ 5
    fake_clock.advance(days=1)
    ok(write_off(user, [(p["id"], 4)], reason="Damaged"))  # Nov 8: 16 @ 5, value 20
    fake_clock.advance(days=1)

    r = ok(user.get("/api/reports/stock-on-date", params={"date": "2026-11-05"}))
    assert r["rows"][0]["qty"] == 10 and r["rows"][0]["value"] == 40.0  # at avg cost then (4), not now (5)
    r = ok(user.get("/api/reports/stock-on-date", params={"date": "2026-11-04"}))
    assert r["rows"] == [] or r["rows"][0]["qty"] == 0
    r = ok(user.get("/api/reports/stock-on-date", params={"date": "2026-11-09"}))
    assert r["rows"][0]["qty"] == 16 and r["total_value"] == 80.0

    m = ok(user.get("/api/reports/movement", params={"from": "2026-11-06", "to": "2026-11-09"}))
    row = m["rows"][0]
    assert (row["opening"], row["received"], row["written_off"], row["adjustments"], row["closing"]) == (
        10,
        10,
        -4,
        0,
        16,
    )
    assert row["opening_value"] == 40 and row["received_value"] == 60 and row["written_off_value"] == -20
    assert row["closing_value"] == 80
    t = m["totals"]
    assert (
        t["opening_value"] + t["received_value"] + t["written_off_value"] + t["adjustments_value"]
        == t["closing_value"]
    )
    err(
        user.get("/api/reports/movement", params={"from": "2026-11-09", "to": "2026-11-01"}),
        422,
        "validation_error",
    )

    wr = ok(user.get("/api/reports/write-offs-by-reason", params={"from": "2026-11-01", "to": "2026-11-30"}))
    assert wr["rows"][0] == {"reason": "Damaged", "documents": 1, "lines": 1, "value": 20.0, "share": 100.0}

    sv = ok(user.get("/api/reports/stock-value"))
    assert sv["total_value"] == 80.0 and sv["rows"][0]["category"]["name"] == "R"
    svc = ok(user.get("/api/reports/stock-value", params={"category_id": cat["id"]}))
    assert svc["by"] == "product" and svc["category_value"] == 80.0

    assert ok(user.get("/api/reports/low-stock"))["rows"] == []
    ok(write_off(user, [(p["id"], 12)]))
    low = ok(user.get("/api/reports/low-stock"))
    assert low["rows"][0]["shortfall"] == 1 and low["restock_cost"] == 10.0  # at purchase price

    for rid, params in (
        ("stock-on-date", {"date": "2026-11-09"}),
        ("movement", {"from": "2026-11-01"}),
        ("low-stock", {}),
        ("write-offs-by-reason", {}),
        ("stock-value", {}),
    ):
        res = user.get(f"/api/reports/{rid}", params={**params, "format": "csv"})
        assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv"), rid
        assert res.headers["content-disposition"].startswith("attachment; filename=")


def test_report_dates_respect_client_timezone(user, fake_clock) -> None:
    p = product(user, "TZ")
    fake_clock.t = fake_clock.t.replace(hour=23, minute=30)  # Nov 5 23:30 UTC = Nov 6 01:30 in Kyiv
    receive(user, [(p["id"], 1, 1)])
    fake_clock.advance(days=1)
    utc = ok(user.get("/api/reports/stock-on-date", params={"date": "2026-11-05"}))
    kyiv = ok(
        user.get(
            "/api/reports/stock-on-date", params={"date": "2026-11-05"}, headers={"X-Timezone": "Europe/Kyiv"}
        )
    )
    assert utc["rows"][0]["qty"] == 1
    assert kyiv["rows"] == [] or kyiv["rows"][0]["qty"] == 0


def test_dashboard(user, fake_clock) -> None:
    p = product(user, "DB", min_stock=100)
    receive(user, [(p["id"], 10, 3)])
    ok(write_off(user, [(p["id"], 2)], reason="Expired"))
    d = ok(user.get("/api/dashboard"))
    k = d["kpis"]
    assert k["stock_value"] == 24.0 and k["active_products"] == 1 and k["low_stock_count"] == 1
    assert k["received_30d"] == 30.0 and k["receipts_30d"] == 1 and k["written_off_30d"] == 6.0
    assert len(d["weeks"]) == 8 and d["weeks"][-1]["receipts"] == 30.0
    assert d["by_reason"][0] == {"reason": "Expired", "value": 6.0}
    assert d["low_stock"]["total"] == 1 and len(d["recent"]) == 2
    assert ok(user.get("/api/dashboard", params={"weeks": 4}))["weeks"].__len__() == 4


def test_history_filters_and_pagination(user) -> None:
    cat = category(user, "H")
    a = product(user, "HA", category_id=cat["id"])
    b = product(user, "HB")
    for _ in range(3):
        receive(user, [(a["id"], 1, 1), (b["id"], 1, 1)])
    ok(write_off(user, [(a["id"], 1)]))
    all_ = ok(user.get("/api/movements", params={"limit": 4}))
    assert all_["total"] == 7 and len(all_["items"]) == 4
    assert all_["items"][0]["type"] == "write_off"
    assert ok(user.get("/api/movements", params={"category_id": cat["id"]}))["total"] == 4
    assert ok(user.get("/api/movements", params={"product_id": b["id"]}))["total"] == 3
    assert ok(user.get("/api/movements", params={"search": "WO-0"}))["total"] == 1
    assert ok(user.get("/api/movements", params={"from": "2030-01-01"}))["total"] == 0
    pm = ok(user.get(f"/api/products/{a['id']}/movements"))
    assert pm["total"] == 4 and pm["items"][0]["balance_after"] == 2


@pytest.mark.parametrize("path", ["/api/receipts", "/api/write-offs"])
def test_document_list_filters(user, path) -> None:
    p = product(user, "LF")
    receive(user, [(p["id"], 50, 1)], supplier="Builders Depot")
    if path == "/api/write-offs":
        ok(write_off(user, [(p["id"], 1)], reason="Damaged"))
        write_off(user, [(p["id"], 1)], post=False)
        items = ok(user.get(path, params={"reason": "Damaged"}))["items"]
        assert len(items) == 1
    else:
        receive(user, [(p["id"], 1, 1)], post=False)
        assert [d["supplier"] for d in ok(user.get(path, params={"search": "depot"}))["items"]] == [
            "Builders Depot"
        ]
    assert len(ok(user.get(path, params={"status": "draft"}))["items"]) == 1
    assert len(ok(user.get(path, params={"from": "2030-01-01"}))["items"]) == 0
    _ = timedelta


def test_legacy_timezone_alias_is_honoured(user, fake_clock) -> None:
    # Chrome reports Kyiv as the legacy "Europe/Kiev"; it must not silently fall back to UTC
    fake_clock.t = fake_clock.t.replace(hour=22, minute=30)  # Nov 5 22:30 UTC = Nov 6 00:30 in Kyiv
    for tz in ("Europe/Kiev", "Europe/Kyiv"):
        assert ok(user.get("/api/dashboard", headers={"X-Timezone": tz}))["today"] == "2026-11-06", tz
    assert ok(user.get("/api/dashboard", headers={"X-Timezone": "Not/AZone"}))["today"] == "2026-11-05"
