"""Reports and dashboard.

Values on a date / for a period come from movements: each movement stores the balance and the average
cost right after it, and its exact value change. So "stock on date" is valued at the average cost in
effect at the end of that day, and period values are the sums of the actual movement values.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta, tzinfo
from decimal import Decimal

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app import clock
from app.api.csvutil import csv_response
from app.api.documents import day_end, day_start
from app.api.schemas import iso, movement_out, num, product_out, product_ref
from app.deps import SessionDep, TzDep, UserDep
from app.errors import field_error, validation_failed
from app.models import Category, Document, Movement, Product, User
from app.services.inventory import REASONS, effective_avg, q2

router = APIRouter(prefix="/api", tags=["reports"])
ZERO = Decimal(0)


def _cat_filter(category_id: str | None):
    if category_id == "none":
        return lambda p: p.category_id is None
    if category_id:
        try:
            cid = int(category_id)
        except ValueError:
            return lambda p: False
        return lambda p: p.category_id == cid
    return lambda p: True


def _cat_label(db, user: User, category_id: str | None) -> str:
    if category_id == "none":
        return "No category"
    if category_id:
        try:
            c = db.scalar(
                select(Category).where(Category.id == int(category_id), Category.user_id == user.id)
            )
        except ValueError:
            c = None
        return c.name if c else "Unknown category"
    return "All categories"


def _products(db, user: User) -> list[Product]:
    return list(db.scalars(select(Product).where(Product.user_id == user.id).order_by(Product.sku)).unique())


def _state_before(db, user: User, before: datetime) -> dict[int, tuple[Decimal, Decimal]]:
    """product_id → (balance, avg_cost) after the last movement strictly before ``before``."""
    sub = (
        select(Movement.product_id, func.max(Movement.id).label("mid"))
        .where(Movement.user_id == user.id, Movement.at < before)
        .group_by(Movement.product_id)
    ).subquery()
    # movement ids grow with time for a product (posting order), so max(id) is the latest one
    rows = db.execute(
        select(Movement.product_id, Movement.balance_after, Movement.avg_cost_after).join(
            sub, sub.c.mid == Movement.id
        )
    ).all()
    return {pid: (bal, avg) for pid, bal, avg in rows}


def _fmt_q(v: float | None) -> str:
    if v is None:
        return ""
    return f"{v:.3f}".rstrip("0").rstrip(".") or "0"


def _m(v) -> str:
    return f"{float(v):.2f}"


def _need(name: str, v):
    if v is None:
        raise validation_failed([field_error(name, "Choose a date.", "missing")])
    return v


def _period_ok(from_: date, to: date) -> None:
    if from_ > to:
        raise validation_failed(
            [field_error("to", "The end date must be on or after the start date.", "range")]
        )


# ------------------------------------------------------------------ stock on date


def stock_on_date(db, user: User, tz: tzinfo, d: date, category_id: str | None) -> dict:
    end = day_end(d, tz)
    state = _state_before(db, user, end)
    match = _cat_filter(category_id)
    rows = []
    for p in _products(db, user):
        if p.created_at >= end or not match(p):
            continue
        bal, avg = state.get(p.id, (ZERO, effective_avg(p)))
        if p.archived_at is not None and bal == 0:
            continue
        value = q2(bal * avg)
        rows.append(
            {
                "product": product_ref(p),
                "category_name": p.category.name if p.category else None,
                "qty": num(bal),
                "avg_cost": num(avg),
                "value": num(value),
            }
        )
    total = q2(sum((Decimal(str(r["value"])) for r in rows), ZERO))
    return {
        "date": d.isoformat(),
        "category_label": _cat_label(db, user, category_id),
        "rows": rows,
        "total_value": num(total),
        "product_count": len(rows),
        "in_stock_count": sum(1 for r in rows if r["qty"] > 0),
    }


@router.get("/reports/stock-on-date")
def r_stock_on_date(
    user: UserDep,
    db: SessionDep,
    tz: TzDep,
    date_: date | None = Query(None, alias="date"),
    category_id: str | None = None,
    format: str | None = None,
):
    d = date_ or clock.now().astimezone(tz).date()
    data = stock_on_date(db, user, tz, d, category_id)
    if format == "csv":
        return csv_response(
            f"stock-on-date-{d.isoformat()}.csv",
            ["SKU", "Product", "Category", "Unit", "Qty on date", "Avg cost", "Value"],
            [
                [
                    r["product"]["sku"],
                    r["product"]["name"],
                    r["category_name"] or "No category",
                    r["product"]["unit"],
                    _fmt_q(r["qty"]),
                    f"{r['avg_cost']:.4f}",
                    _m(r["value"]),
                ]
                for r in data["rows"]
            ]
            + [["", "Total", "", "", "", "", _m(data["total_value"])]],
        )
    return data


# ------------------------------------------------------------------ stock movement


def stock_movement(db, user: User, tz: tzinfo, from_: date, to: date, category_id: str | None) -> dict:
    start, end = day_start(from_, tz), day_end(to, tz)
    opening = _state_before(db, user, start)
    closing = _state_before(db, user, end)
    match = _cat_filter(category_id)
    agg: dict[int, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: ZERO))
    q = (
        select(Movement.product_id, Document.kind, Movement.qty_change, Movement.value_change)
        .join(Document, Document.id == Movement.document_id)
        .where(Movement.user_id == user.id, Movement.at >= start, Movement.at < end)
    )
    for pid, kind, qty, value in db.execute(q):
        bucket = (
            "received"
            if kind in ("receipt", "receipt_reversal")
            else "written_off"
            if kind in ("write_off", "write_off_reversal")
            else "adjustments"
        )
        agg[pid][bucket] += qty
        agg[pid][bucket + "_value"] += value
    rows = []
    totals = defaultdict(lambda: ZERO)
    for p in _products(db, user):
        if p.created_at >= end or not match(p):
            continue
        ob, oa = opening.get(p.id, (ZERO, ZERO))
        cb, ca = closing.get(p.id, (ZERO, ZERO))
        a = agg.get(p.id, {})
        r = {
            "opening": ob,
            "received": a.get("received", ZERO),
            "written_off": a.get("written_off", ZERO),
            "adjustments": a.get("adjustments", ZERO),
            "closing": cb,
            "opening_value": ob * oa,
            "received_value": a.get("received_value", ZERO),
            "written_off_value": a.get("written_off_value", ZERO),
            "adjustments_value": a.get("adjustments_value", ZERO),
            "closing_value": cb * ca,
        }
        if all(r[k] == 0 for k in ("opening", "received", "written_off", "adjustments", "closing")):
            continue
        for k in (
            "opening_value",
            "received_value",
            "written_off_value",
            "adjustments_value",
            "closing_value",
        ):
            totals[k] += r[k]
        out = {"product": product_ref(p)}
        for k, v in r.items():
            out[k] = num(q2(v)) if k.endswith("_value") else num(v)
        rows.append(out)
    rows.sort(key=lambda r: r["product"]["name"].lower())
    t = {
        k: num(q2(totals[k]))
        for k in (
            "opening_value",
            "received_value",
            "written_off_value",
            "adjustments_value",
            "closing_value",
        )
    }
    moved = sum(1 for r in rows if r["received"] or r["written_off"] or r["adjustments"])
    return {
        "from": from_.isoformat(),
        "to": to.isoformat(),
        "category_label": _cat_label(db, user, category_id),
        "rows": rows,
        "totals": t,
        "moved_count": moved,
    }


@router.get("/reports/movement")
def r_movement(
    user: UserDep,
    db: SessionDep,
    tz: TzDep,
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    category_id: str | None = None,
    format: str | None = None,
):
    today = clock.now().astimezone(tz).date()
    from_ = from_ or today.replace(day=1)
    to = to or today
    _period_ok(from_, to)
    data = stock_movement(db, user, tz, from_, to, category_id)
    if format == "csv":
        t = data["totals"]
        return csv_response(
            f"movement-{from_.isoformat()}-to-{to.isoformat()}.csv",
            [
                "SKU",
                "Product",
                "Unit",
                "Opening",
                "Received",
                "Written off",
                "Adjustments",
                "Closing",
                "Opening value",
                "Received value",
                "Written off value",
                "Adjustments value",
                "Closing value",
            ],
            [
                [
                    r["product"]["sku"],
                    r["product"]["name"],
                    r["product"]["unit"],
                    _fmt_q(r["opening"]),
                    _fmt_q(r["received"]),
                    _fmt_q(r["written_off"]),
                    _fmt_q(r["adjustments"]),
                    _fmt_q(r["closing"]),
                    _m(r["opening_value"]),
                    _m(r["received_value"]),
                    _m(r["written_off_value"]),
                    _m(r["adjustments_value"]),
                    _m(r["closing_value"]),
                ]
                for r in data["rows"]
            ]
            + [
                [
                    "",
                    "Total value",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    _m(t["opening_value"]),
                    _m(t["received_value"]),
                    _m(t["written_off_value"]),
                    _m(t["adjustments_value"]),
                    _m(t["closing_value"]),
                ]
            ],
        )
    return data


# ------------------------------------------------------------------ low stock


def _last_receipts(db, user: User) -> dict[int, datetime]:
    return dict(
        db.execute(
            select(Movement.product_id, func.max(Movement.at))
            .where(Movement.user_id == user.id, Movement.type == "receipt")
            .group_by(Movement.product_id)
        ).all()
    )


def low_stock(db, user: User, category_id: str | None) -> dict:
    match = _cat_filter(category_id)
    last = _last_receipts(db, user)
    rows = []
    for p in _products(db, user):
        if p.archived_at is not None or p.min_stock is None or p.stock > p.min_stock or not match(p):
            continue
        rows.append((p, max(ZERO, p.min_stock - p.stock)))
    rows.sort(key=lambda x: (x[0].stock / x[0].min_stock) if x[0].min_stock else Decimal(-1))
    cost = q2(sum((short * p.purchase_price for p, short in rows), ZERO))
    return {
        "category_label": _cat_label(db, user, category_id),
        "rows": [
            {
                "product": product_ref(p),
                "category_name": p.category.name if p.category else None,
                "stock": num(p.stock),
                "min_stock": num(p.min_stock),
                "shortfall": num(short),
                "last_receipt_at": iso(last.get(p.id)),
            }
            for p, short in rows
        ],
        "out_of_stock_count": sum(1 for p, _ in rows if p.stock == 0),
        "restock_cost": num(cost),
    }


@router.get("/reports/low-stock")
def r_low_stock(
    user: UserDep,
    db: SessionDep,
    tz: TzDep,
    category_id: str | None = None,
    format: str | None = None,
):
    data = low_stock(db, user, category_id)
    if format == "csv":
        today = clock.now().astimezone(tz).date().isoformat()
        return csv_response(
            f"low-stock-{today}.csv",
            [
                "SKU",
                "Product",
                "Category",
                "Unit",
                "Stock",
                "Min stock",
                "Shortfall",
                "Last receipt",
                "Status",
            ],
            [
                [
                    r["product"]["sku"],
                    r["product"]["name"],
                    r["category_name"] or "No category",
                    r["product"]["unit"],
                    _fmt_q(r["stock"]),
                    _fmt_q(r["min_stock"]),
                    _fmt_q(r["shortfall"]),
                    r["last_receipt_at"][:10] if r["last_receipt_at"] else "",
                    "Out of stock" if r["stock"] == 0 else "Low stock",
                ]
                for r in data["rows"]
            ],
        )
    return data


# ------------------------------------------------------------------ write-offs by reason


def write_offs_by_reason(db, user: User, tz: tzinfo, from_: date, to: date, category_id: str | None) -> dict:
    start, end = day_start(from_, tz), day_end(to, tz)
    match = _cat_filter(category_id)
    docs = db.scalars(
        select(Document)
        .where(
            Document.user_id == user.id,
            Document.kind == "write_off",
            Document.status.in_(["posted", "reversed"]),
            Document.posted_at >= start,
            Document.posted_at < end,
        )
        .options(selectinload(Document.lines))
    ).unique()
    by = {r: {"reason": r, "documents": 0, "lines": 0, "value": ZERO} for r in REASONS}
    reversed_numbers = []
    for d in docs:
        if d.status == "reversed":
            reversed_numbers.append(d.number)
            continue
        ls = [ln for ln in d.lines if ln.product is not None and match(ln.product)]
        if not ls:
            continue
        b = by[d.reason or "Other"]
        b["documents"] += 1
        b["lines"] += len(ls)
        b["value"] += sum(((ln.qty or ZERO) * (ln.unit_cost or ZERO) for ln in ls), ZERO)
    total = q2(sum((b["value"] for b in by.values()), ZERO))
    rows = sorted(by.values(), key=lambda b: -b["value"])
    return {
        "from": from_.isoformat(),
        "to": to.isoformat(),
        "category_label": _cat_label(db, user, category_id),
        "rows": [
            {
                "reason": b["reason"],
                "documents": b["documents"],
                "lines": b["lines"],
                "value": num(q2(b["value"])),
                "share": num(q2(b["value"] / total * 100)) if total else 0.0,
            }
            for b in rows
        ],
        "total_value": num(total),
        "document_count": sum(b["documents"] for b in rows),
        "line_count": sum(b["lines"] for b in rows),
        "reversed_numbers": sorted(reversed_numbers),
    }


@router.get("/reports/write-offs-by-reason")
def r_write_offs(
    user: UserDep,
    db: SessionDep,
    tz: TzDep,
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    category_id: str | None = None,
    format: str | None = None,
):
    today = clock.now().astimezone(tz).date()
    to = to or today
    from_ = from_ or (to - timedelta(days=30))
    _period_ok(from_, to)
    data = write_offs_by_reason(db, user, tz, from_, to, category_id)
    if format == "csv":
        return csv_response(
            f"write-offs-by-reason-{from_.isoformat()}-to-{to.isoformat()}.csv",
            ["Reason", "Documents", "Line items", "Value", "Share %"],
            [
                [r["reason"], r["documents"], r["lines"], _m(r["value"]), f"{r['share']:.1f}"]
                for r in data["rows"]
            ]
            + [
                [
                    "Total",
                    data["document_count"],
                    data["line_count"],
                    _m(data["total_value"]),
                    "100.0" if data["total_value"] else "0.0",
                ]
            ],
        )
    return data


# ------------------------------------------------------------------ stock value


def stock_value(db, user: User, category_id: str | None) -> dict:
    products = _products(db, user)
    active = [p for p in products if p.archived_at is None]
    total = q2(sum((p.stock * effective_avg(p) for p in active), ZERO))
    archived_value = q2(
        sum(
            (
                p.stock * effective_avg(p)
                for p in products
                if p.archived_at is not None and _cat_filter(category_id)(p)
            ),
            ZERO,
        )
    )
    base = {
        "total_value": num(total),
        "active_count": len(active),
        "in_stock_count": sum(1 for p in active if p.stock > 0),
        "archived_value": num(archived_value),
        "category_label": _cat_label(db, user, category_id),
    }
    if category_id:
        match = _cat_filter(category_id)
        ps = [p for p in active if match(p)]
        ct = q2(sum((p.stock * effective_avg(p) for p in ps), ZERO))
        rows = sorted(
            (
                {
                    "product": product_ref(p),
                    "stock": num(p.stock),
                    "avg_cost": num(effective_avg(p)),
                    "value": num(q2(p.stock * effective_avg(p))),
                }
                for p in ps
            ),
            key=lambda r: -r["value"],
        )
        for r in rows:
            r["share"] = num(q2(Decimal(str(r["value"])) / ct * 100)) if ct else 0.0
        return {
            **base,
            "by": "product",
            "rows": rows,
            "category_value": num(ct),
            "category_count": len(ps),
            "category_in_stock": sum(1 for p in ps if p.stock > 0),
        }
    cats = list(db.scalars(select(Category).where(Category.user_id == user.id)))
    groups: dict[int | None, list[Product]] = defaultdict(list)
    for p in active:
        groups[p.category_id].append(p)
    rows = []
    for c in cats + ([None] if groups.get(None) else []):
        ps = groups.get(c.id if c else None, [])
        v = q2(sum((p.stock * effective_avg(p) for p in ps), ZERO))
        rows.append(
            {
                "category": {"id": c.id, "name": c.name} if c else None,
                "product_count": len(ps),
                "in_stock_count": sum(1 for p in ps if p.stock > 0),
                "value": num(v),
                "share": num(q2(v / total * 100)) if total else 0.0,
            }
        )
    rows.sort(key=lambda r: (-r["value"], (r["category"] or {"name": "~"})["name"].lower()))
    return {**base, "by": "category", "rows": rows}


@router.get("/reports/stock-value")
def r_stock_value(
    user: UserDep,
    db: SessionDep,
    tz: TzDep,
    category_id: str | None = None,
    format: str | None = None,
):
    data = stock_value(db, user, category_id)
    if format == "csv":
        today = clock.now().astimezone(tz).date().isoformat()
        if data["by"] == "product":
            slug = "".join(ch if ch.isalnum() else "-" for ch in data["category_label"].lower()).strip("-")
            return csv_response(
                f"stock-value-{slug}-{today}.csv",
                ["SKU", "Product", "Unit", "Stock", "Avg cost", "Value", "Share %"],
                [
                    [
                        r["product"]["sku"],
                        r["product"]["name"],
                        r["product"]["unit"],
                        _fmt_q(r["stock"]),
                        f"{r['avg_cost']:.4f}",
                        _m(r["value"]),
                        f"{r['share']:.1f}",
                    ]
                    for r in data["rows"]
                ]
                + [["", "Total", "", "", "", _m(data["category_value"]), ""]],
            )
        return csv_response(
            f"stock-value-{today}.csv",
            ["Category", "Active products", "Value", "Share %"],
            [
                [
                    (r["category"] or {"name": "No category"})["name"],
                    r["product_count"],
                    _m(r["value"]),
                    f"{r['share']:.1f}",
                ]
                for r in data["rows"]
            ]
            + [["Total", data["active_count"], _m(data["total_value"]), "100.0"]],
        )
    return data


# ------------------------------------------------------------------ dashboard


@router.get("/dashboard")
def dashboard(user: UserDep, db: SessionDep, tz: TzDep, weeks: int = Query(8, ge=1, le=26)) -> dict:
    now = clock.now()
    today = now.astimezone(tz).date()
    products = _products(db, user)
    active = [p for p in products if p.archived_at is None]
    low = [p for p in active if p.min_stock is not None and p.stock <= p.min_stock]
    low.sort(key=lambda p: (p.stock / p.min_stock) if p.min_stock else Decimal(-1))
    period_from = today - timedelta(days=30)
    start30 = day_start(period_from, tz)

    week0 = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks - 1)
    wk_start = day_start(week0, tz)
    docs = list(
        db.scalars(
            select(Document)
            .where(
                Document.user_id == user.id,
                Document.kind.in_(["receipt", "write_off"]),
                Document.status == "posted",
                Document.posted_at >= min(wk_start, start30),
            )
            .options(selectinload(Document.lines))
        ).unique()
    )

    def total(d: Document) -> Decimal:
        if d.kind == "receipt":
            return sum(((ln.qty or ZERO) * (ln.price or ZERO) for ln in d.lines), ZERO)
        return sum(((ln.qty or ZERO) * (ln.unit_cost or ZERO) for ln in d.lines), ZERO)

    series = []
    for i in range(weeks):
        ws = week0 + timedelta(weeks=i)
        a, b = day_start(ws, tz), day_end(ws + timedelta(days=6), tz)
        rec = sum((total(d) for d in docs if d.kind == "receipt" and a <= d.posted_at < b), ZERO)
        wo = sum((total(d) for d in docs if d.kind == "write_off" and a <= d.posted_at < b), ZERO)
        series.append(
            {
                "start": ws.isoformat(),
                "label": f"{ws.strftime('%b')} {ws.day}",
                "receipts": num(q2(rec)),
                "write_offs": num(q2(wo)),
            }
        )
    recent30 = [d for d in docs if d.posted_at >= start30]
    rec30 = [d for d in recent30 if d.kind == "receipt"]
    wo30 = [d for d in recent30 if d.kind == "write_off"]
    by_reason = {r: ZERO for r in REASONS}
    for d in wo30:
        by_reason[d.reason or "Other"] += total(d)
    moved = set(db.scalars(select(Movement.product_id).where(Movement.user_id == user.id).distinct()))
    recent = db.scalars(
        select(Movement)
        .where(Movement.user_id == user.id)
        .order_by(Movement.at.desc(), Movement.id.desc())
        .limit(8)
    ).unique()
    last = _last_receipts(db, user)
    return {
        "today": today.isoformat(),
        "kpis": {
            "stock_value": num(q2(sum((p.stock * effective_avg(p) for p in active), ZERO))),
            "active_products": len(active),
            "archived_products": len(products) - len(active),
            "low_stock_count": len(low),
            "received_30d": num(q2(sum((total(d) for d in rec30), ZERO))),
            "receipts_30d": len(rec30),
            "written_off_30d": num(q2(sum((total(d) for d in wo30), ZERO))),
            "write_offs_30d": len(wo30),
        },
        "weeks": series,
        "by_reason": sorted(
            ({"reason": r, "value": num(q2(v))} for r, v in by_reason.items()),
            key=lambda x: -x["value"],
        ),
        "period": {"from": period_from.isoformat(), "to": today.isoformat()},
        "low_stock": {
            "items": [
                product_out(p, has_movements=p.id in moved, last_receipt_at=last.get(p.id)) for p in low[:5]
            ],
            "total": len(low),
        },
        "recent": [movement_out(m) for m in recent],
        "has_products": bool(products),
    }
