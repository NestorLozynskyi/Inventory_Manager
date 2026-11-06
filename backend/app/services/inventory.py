"""Stock posting rules: receipts, write-offs, reversals and stock counts.

Valuation — weighted average unit cost per product (``Product.avg_cost``, 4 dp):

* posted receipt line (qty q, price p):  avg' = (S·avg + q·p) / (S + q)
* write-off line:                       stock decreases, avg unchanged, line cost = avg at posting
* stock count difference d:              stock = actual, avg unchanged, valued at avg at posting
* receipt reversal (q at line price p):  S' = S − q; avg' = (S·avg − q·p) / S' if S' > 0 (floored at 0),
                                          otherwise avg unchanged. When nothing happened in between this
                                          restores exactly the average before the receipt.
* write-off reversal (q at cost c):      returns stock like a receipt at price c.
* before the first receipt avg = purchase price (``effective_avg``).

Every movement stores ``value_change`` = (S'·avg') − (S·avg), so the stock value on any date is the sum
of value changes and period reports reconcile exactly (opening + changes = closing).

Concurrency — every posting/reversal locks the document row (``FOR UPDATE``) and then all affected
product rows in id order (``FOR UPDATE``), re-reads stock and checks it under the lock; a DB CHECK
(stock >= 0) is the last line of defence.
"""

from collections import OrderedDict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app import clock
from app.errors import AppError, field_error, validation_failed
from app.models import DocCounter, Document, DocumentLine, Movement, Product, User

UNITS = ("pcs", "kg", "g", "l", "m", "m²", "pack")
WHOLE_UNITS = frozenset({"pcs", "pack"})
REASONS = ("Sale", "Damaged", "Expired", "Lost / Theft", "Internal use", "Other")

Q3 = Decimal("0.001")
Q2 = Decimal("0.01")
Q4 = Decimal("0.0001")
Q6 = Decimal("0.000001")
ZERO = Decimal(0)

PREFIX = {
    "receipt": "RC",
    "write_off": "WO",
    "receipt_reversal": "RV",
    "write_off_reversal": "RV",
    "stock_count": "SC",
}


def q3(v: Decimal) -> Decimal:
    return v.quantize(Q3, ROUND_HALF_UP)


def q2(v: Decimal) -> Decimal:
    return v.quantize(Q2, ROUND_HALF_UP)


def q4(v: Decimal) -> Decimal:
    return v.quantize(Q4, ROUND_HALF_UP)


def effective_avg(p: Product) -> Decimal:
    return p.avg_cost if p.avg_cost is not None else p.purchase_price


def qty_error(unit: str | None, qty: Decimal | None, *, allow_zero: bool = False) -> str | None:
    """Return a user-facing error for a quantity in the given unit, or None if valid."""
    if qty is None:
        return "Enter a quantity."
    if qty < 0 or (qty == 0 and not allow_zero):
        return "Enter a quantity of 0 or more." if allow_zero else "Enter a quantity greater than 0."
    if qty >= Decimal("100000000000"):
        return "The quantity is too large."
    if unit in WHOLE_UNITS:
        if qty != qty.to_integral_value():
            return f"Enter a whole number — {unit} can't be fractional."
    elif qty != q3(qty):
        return "Use at most 3 decimal places."
    return None


def next_number(db: Session, user_id: int, kind: str) -> str:
    prefix = PREFIX[kind]
    stmt = (
        insert(DocCounter)
        .values(user_id=user_id, prefix=prefix, last=1)
        .on_conflict_do_update(
            index_elements=[DocCounter.user_id, DocCounter.prefix],
            set_={"last": DocCounter.last + 1},
        )
        .returning(DocCounter.last)
    )
    n = db.execute(stmt).scalar_one()
    return f"{prefix}-{n:06d}"


def set_counter(db: Session, user_id: int, prefix: str, last: int) -> None:
    stmt = (
        insert(DocCounter)
        .values(user_id=user_id, prefix=prefix, last=last)
        .on_conflict_do_update(index_elements=[DocCounter.user_id, DocCounter.prefix], set_={"last": last})
    )
    db.execute(stmt)


def lock_document(db: Session, user: User, doc_id: int, kinds: Iterable[str]) -> Document:
    doc = db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.user_id == user.id, Document.kind.in_(list(kinds)))
        .with_for_update(of=Document)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if doc is None:
        raise AppError(404, "not_found", "Document not found.")
    return doc


def lock_products(db: Session, user: User, ids: Iterable[int]) -> dict[int, Product]:
    ids = sorted(set(ids))
    if not ids:
        return {}
    rows = db.execute(
        select(Product)
        .where(Product.user_id == user.id, Product.id.in_(ids))
        .order_by(Product.id)
        .with_for_update(of=Product)
        .execution_options(populate_existing=True)
    ).scalars()
    found = {p.id: p for p in rows}
    return found


def require_draft(doc: Document) -> None:
    if doc.status != "draft":
        raise AppError(409, "document_not_draft", "Posted documents can't be changed.")


@dataclass
class _Change:
    product: Product
    qty_change: Decimal
    unit_cost: Decimal
    new_avg: Decimal


def _apply(db: Session, user: User, doc: Document, mtype: str, ch: _Change, at: datetime) -> None:
    p = ch.product
    old_stock = p.stock
    old_value = old_stock * effective_avg(p)
    new_stock = q3(old_stock + ch.qty_change)
    if new_stock < 0:  # guarded earlier; defensive
        raise AppError(409, "insufficient_stock", "Not enough stock.")
    new_avg = q4(ch.new_avg)
    p.stock = new_stock
    p.avg_cost = new_avg
    p.updated_at = at
    value_change = (new_stock * new_avg - old_value).quantize(Q6, ROUND_HALF_UP)
    db.add(
        Movement(
            user_id=user.id,
            document_id=doc.id,
            product_id=p.id,
            type=mtype,
            at=at,
            qty_change=q3(ch.qty_change),
            balance_after=new_stock,
            unit_cost=q4(ch.unit_cost),
            value_change=value_change,
            avg_cost_after=new_avg,
        )
    )


def _shortages(need: OrderedDict[int, tuple[Decimal, int]], products: dict[int, Product]) -> list[dict]:
    out = []
    for pid, (required, line_index) in need.items():
        p = products[pid]
        if p.stock < required:
            out.append(
                {
                    "product_id": p.id,
                    "sku": p.sku,
                    "name": p.name,
                    "unit": p.unit,
                    "required": float(required),
                    "available": float(p.stock),
                    "line_index": line_index,
                }
            )
    return out


def _insufficient(shortages: list[dict], verb: str) -> AppError:
    n = len(shortages)
    return AppError(
        409,
        "insufficient_stock",
        f"Not enough stock to {verb}: {n} product{'s' if n != 1 else ''} would go below zero.",
        [
            {
                "field": f"lines.{s['line_index']}.qty",
                "message": f"Only {_fmt(s['available'])} {s['unit']} in stock.",
                "type": "insufficient_stock",
            }
            for s in shortages
        ],
        shortages=shortages,
    )


def _fmt(v: float) -> str:
    d = Decimal(str(v)).normalize()
    return f"{d:f}"


def validate_lines_for_posting(doc: Document, *, with_price: bool) -> None:
    details = []
    lines = [ln for ln in doc.lines]
    if not lines:
        raise validation_failed(
            [field_error("lines", "Add at least one line.", "min_lines")],
            "Add at least one line to post this document.",
        )
    for i, ln in enumerate(lines):
        if ln.product_id is None:
            details.append(field_error(f"lines.{i}.product_id", "Choose a product.", "required"))
        unit = ln.product.unit if ln.product is not None else None
        err = qty_error(unit, ln.qty)
        if err:
            details.append(field_error(f"lines.{i}.qty", err, "invalid_qty"))
        if with_price and ln.product_id is not None and (ln.price is None or ln.price < 0):
            details.append(
                field_error(f"lines.{i}.price", "Enter a price of $0.00 or more.", "invalid_price")
            )
    if details:
        n = len(details)
        raise validation_failed(details, f"Fix {n} problem{'s' if n != 1 else ''} to post.")


def _check_archived(doc: Document, products: dict[int, Product]) -> None:
    details = [
        field_error(
            f"lines.{i}.product_id",
            f"{products[ln.product_id].name} is archived. Restore it or remove the line.",
            "product_archived",
        )
        for i, ln in enumerate(doc.lines)
        if ln.product_id is not None and products[ln.product_id].archived_at is not None
    ]
    if details:
        raise AppError(409, "product_archived", "Archived products can't be posted.", details)


def _required_by_product(doc: Document) -> OrderedDict[int, tuple[Decimal, int]]:
    need: OrderedDict[int, tuple[Decimal, int]] = OrderedDict()
    for i, ln in enumerate(doc.lines):
        assert ln.product_id is not None and ln.qty is not None
        prev, first = need.get(ln.product_id, (ZERO, i))
        need[ln.product_id] = (prev + ln.qty, first)
    return need


# --------------------------------------------------------------------------- posting


def post_receipt(db: Session, user: User, doc_id: int, at: datetime | None = None) -> Document:
    at = at or clock.now()
    doc = lock_document(db, user, doc_id, ["receipt"])
    require_draft(doc)
    validate_lines_for_posting(doc, with_price=True)
    products = lock_products(db, user, [ln.product_id for ln in doc.lines])  # type: ignore[misc]
    _check_archived(doc, products)
    doc.status = "posted"
    doc.posted_at = at
    for ln in doc.lines:
        p = products[ln.product_id]  # type: ignore[index]
        qty, price = ln.qty, ln.price
        assert qty is not None and price is not None
        base = max(p.stock, ZERO)
        new_avg = (base * effective_avg(p) + qty * price) / (base + qty)
        _apply(db, user, doc, "receipt", _Change(p, qty, price, new_avg), at)
    db.flush()
    return doc


def post_write_off(db: Session, user: User, doc_id: int, at: datetime | None = None) -> Document:
    at = at or clock.now()
    doc = lock_document(db, user, doc_id, ["write_off"])
    require_draft(doc)
    validate_lines_for_posting(doc, with_price=False)
    if doc.reason not in REASONS:
        raise validation_failed([field_error("reason", "Choose a reason.", "required")])
    products = lock_products(db, user, [ln.product_id for ln in doc.lines])  # type: ignore[misc]
    _check_archived(doc, products)
    shortages = _shortages(_required_by_product(doc), products)
    if shortages:
        raise _insufficient(shortages, "post this write-off")
    doc.status = "posted"
    doc.posted_at = at
    for ln in doc.lines:
        p = products[ln.product_id]  # type: ignore[index]
        cost = effective_avg(p)
        ln.unit_cost = q4(cost)
        assert ln.qty is not None
        _apply(db, user, doc, "write_off", _Change(p, -ln.qty, cost, cost), at)
    db.flush()
    return doc


def reverse_document(
    db: Session, user: User, doc_id: int, note: str = "", at: datetime | None = None
) -> Document:
    at = at or clock.now()
    orig = lock_document(db, user, doc_id, ["receipt", "write_off"])
    if orig.status == "draft":
        raise AppError(409, "document_not_draft", "Only posted documents can be reversed.")
    if orig.status == "reversed" or orig.reversed_by is not None:
        raise AppError(409, "already_reversed", "This document has already been reversed.")
    products = lock_products(db, user, [ln.product_id for ln in orig.lines])  # type: ignore[misc]
    kind = "receipt_reversal" if orig.kind == "receipt" else "write_off_reversal"
    if orig.kind == "receipt":
        shortages = _shortages(_required_by_product(orig), products)
        if shortages:
            raise _insufficient(shortages, "reverse this receipt")
    rv = Document(
        user_id=user.id,
        kind=kind,
        number=next_number(db, user.id, kind),
        status="posted",
        supplier=orig.supplier,
        reason=orig.reason,
        note=note.strip(),
        reverses_id=orig.id,
        created_at=at,
        posted_at=at,
    )
    for i, ln in enumerate(orig.lines):
        rv.lines.append(
            DocumentLine(
                position=i,
                product_id=ln.product_id,
                qty=ln.qty,
                price=ln.price,
                unit_cost=ln.unit_cost,
            )
        )
    db.add(rv)
    db.flush()
    orig.status = "reversed"
    for ln in orig.lines:
        p = products[ln.product_id]  # type: ignore[index]
        qty = ln.qty
        assert qty is not None
        avg = effective_avg(p)
        if orig.kind == "receipt":
            price = ln.price
            assert price is not None
            remaining = p.stock - qty
            new_avg = max(ZERO, (p.stock * avg - qty * price) / remaining) if remaining > 0 else avg
            _apply(db, user, rv, "reversal", _Change(p, -qty, price, new_avg), at)
        else:
            cost = ln.unit_cost if ln.unit_cost is not None else avg
            base = max(p.stock, ZERO)
            new_avg = (base * avg + qty * cost) / (base + qty)
            _apply(db, user, rv, "reversal", _Change(p, qty, cost, new_avg), at)
    db.flush()
    return rv


def post_stock_count(db: Session, user: User, doc_id: int, at: datetime | None = None) -> Document:
    at = at or clock.now()
    doc = lock_document(db, user, doc_id, ["stock_count"])
    require_draft(doc)
    counted = [ln for ln in doc.lines if ln.actual_qty is not None]
    if not counted:
        raise validation_failed(
            [field_error("lines", "Enter the actual quantity for at least one product.", "required")],
            "Count at least one product to post.",
        )
    products = lock_products(db, user, [ln.product_id for ln in doc.lines])  # type: ignore[misc]
    doc.status = "posted"
    doc.posted_at = at
    for ln in doc.lines:
        p = products[ln.product_id]  # type: ignore[index]
        cost = effective_avg(p)
        ln.book_qty = p.stock
        ln.unit_cost = q4(cost)
        if ln.actual_qty is None:
            continue
        diff = q3(ln.actual_qty - p.stock)
        if diff == 0:
            continue
        _apply(db, user, doc, "stock_count", _Change(p, diff, cost, cost), at)
    db.flush()
    return doc


def replace_lines(doc: Document, lines: Sequence[DocumentLine]) -> None:
    doc.lines.clear()
    for i, ln in enumerate(lines):
        ln.position = i
        doc.lines.append(ln)
