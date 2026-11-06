from fastapi.testclient import TestClient


def ok(r, code: int = 200) -> dict:
    assert r.status_code == code, f"{r.status_code}: {r.text}"
    return r.json() if r.content else {}


def err(r, status: int, code: str) -> dict:
    assert r.status_code == status, f"{r.status_code}: {r.text}"
    e = r.json()["error"]
    assert e["code"] == code, e
    return e


def category(c: TestClient, name: str = "Tools") -> dict:
    return ok(c.post("/api/categories", json={"name": name}), 201)


def product(c: TestClient, sku: str = "SKU-1", unit: str = "pcs", price: str = "10.00", **kw) -> dict:
    body = {
        "sku": sku,
        "name": kw.pop("name", f"Product {sku}"),
        "unit": unit,
        "purchase_price": price,
        "sale_price": kw.pop("sale_price", "20.00"),
        **kw,
    }
    return ok(c.post("/api/products", json=body), 201)


def receive(
    c: TestClient, lines: list[tuple[int, object, object]], supplier: str = "", post: bool = True
) -> dict:
    d = ok(
        c.post(
            "/api/receipts",
            json={
                "supplier": supplier,
                "lines": [{"product_id": p, "qty": q, "price": pr} for p, q, pr in lines],
            },
        ),
        201,
    )
    if post:
        d = ok(c.post(f"/api/receipts/{d['id']}/post"))
    return d


def write_off(c: TestClient, lines: list[tuple[int, object]], reason: str = "Sale", post: bool = True):
    d = ok(
        c.post(
            "/api/write-offs",
            json={"reason": reason, "lines": [{"product_id": p, "qty": q} for p, q in lines]},
        ),
        201,
    )
    if post:
        return c.post(f"/api/write-offs/{d['id']}/post")
    return d


def stock(c: TestClient, pid: int) -> float:
    return ok(c.get(f"/api/products/{pid}"))["stock"]


def get_product(c: TestClient, pid: int) -> dict:
    return ok(c.get(f"/api/products/{pid}"))
