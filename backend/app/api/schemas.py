"""Request bodies (validation) and response serialisation helpers."""

import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models import Document, DocumentLine, Movement, Product
from app.services.inventory import REASONS, UNITS, effective_avg, q2

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Str = Annotated[str, StringConstraints(strip_whitespace=True)]


# ------------------------------------------------------------------- auth


class Credentials(_In):
    email: Annotated[str, StringConstraints(strip_whitespace=True, max_length=254)]
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        if not v:
            raise ValueError("Enter your email address.")
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address, like name@company.com.")
        return v.lower()


class SignIn(Credentials):
    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if not v:
            raise ValueError("Enter your password.")
        return v


class SignUp(Credentials):
    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if not v:
            raise ValueError("Create a password.")
        if len(v) < 8:
            raise ValueError("Use at least 8 characters.")
        if len(v) > 128:
            raise ValueError("Use at most 128 characters.")
        return v


# -------------------------------------------------------------- catalogue


class CategoryIn(_In):
    name: Str

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not v:
            raise ValueError("Enter a category name.")
        if len(v) > 60:
            raise ValueError("Use at most 60 characters.")
        return v


def _money(v: Any, label: str) -> Decimal:
    if v is None or v == "":
        raise ValueError(f"Enter a {label}.")
    try:
        d = Decimal(str(v))
    except Exception as e:
        raise ValueError("Enter a valid amount, like 12.50.") from e
    if not d.is_finite():
        raise ValueError("Enter a valid amount, like 12.50.")
    if d < 0:
        raise ValueError("The price can't be negative.")
    if d != d.quantize(Decimal("0.01")):
        raise ValueError("Use at most 2 decimal places.")
    if d >= Decimal("10000000000"):
        raise ValueError("The amount is too large.")
    return d


def _decimal(v: Any) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        d = Decimal(str(v))
    except Exception as e:
        raise ValueError("Enter a valid number.") from e
    if not d.is_finite():
        raise ValueError("Enter a valid number.")
    return d


class ProductIn(_In):
    sku: Str
    name: Str
    category_id: int | None = None
    unit: str
    purchase_price: Any = None
    sale_price: Any = None
    min_stock: Any = None
    description: Str = ""

    @field_validator("sku")
    @classmethod
    def _sku(cls, v: str) -> str:
        if not v:
            raise ValueError("Enter a SKU.")
        if len(v) > 40:
            raise ValueError("Use at most 40 characters.")
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not v:
            raise ValueError("Enter a product name.")
        if len(v) > 120:
            raise ValueError("Use at most 120 characters.")
        return v

    @field_validator("unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if v not in UNITS:
            raise ValueError("Select a unit of measure.")
        return v

    @field_validator("purchase_price")
    @classmethod
    def _pp(cls, v: Any) -> Decimal:
        return _money(v, "purchase price")

    @field_validator("sale_price")
    @classmethod
    def _sp(cls, v: Any) -> Decimal:
        return _money(v, "sale price")

    @field_validator("min_stock")
    @classmethod
    def _min(cls, v: Any) -> Decimal | None:
        d = _decimal(v)
        if d is not None and d < 0:
            raise ValueError("Minimum stock can't be negative.")
        return d

    @field_validator("description")
    @classmethod
    def _desc(cls, v: str) -> str:
        if len(v) > 1000:
            raise ValueError("Use at most 1000 characters.")
        return v


# -------------------------------------------------------------- documents


class LineIn(_In):
    product_id: int | None = None
    qty: Any = None
    price: Any = None

    @field_validator("qty")
    @classmethod
    def _qty(cls, v: Any) -> Decimal | None:
        return _decimal(v)

    @field_validator("price")
    @classmethod
    def _price(cls, v: Any) -> Decimal | None:
        if v is None or v == "":
            return None
        return _money(v, "price")


class _DocIn(_In):
    note: Str = ""
    lines: list[LineIn] = Field(default_factory=list)

    @field_validator("note")
    @classmethod
    def _note(cls, v: str) -> str:
        if len(v) > 1000:
            raise ValueError("Use at most 1000 characters.")
        return v

    @field_validator("lines")
    @classmethod
    def _lines(cls, v: list[LineIn]) -> list[LineIn]:
        if len(v) > 500:
            raise ValueError("A document can have at most 500 lines.")
        return v


class ReceiptIn(_DocIn):
    supplier: Str = ""

    @field_validator("supplier")
    @classmethod
    def _supplier(cls, v: str) -> str:
        if len(v) > 120:
            raise ValueError("Use at most 120 characters.")
        return v


class WriteOffIn(_DocIn):
    reason: str = "Sale"

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        if v not in REASONS:
            raise ValueError("Choose a reason.")
        return v


class ReverseIn(_In):
    note: Str = ""


class StockCountIn(_In):
    category_id: int | None = None
    note: Str = ""


class CountLineIn(_In):
    id: int
    actual_qty: Any = None

    @field_validator("actual_qty")
    @classmethod
    def _q(cls, v: Any) -> Decimal | None:
        return _decimal(v)


class StockCountPatch(_In):
    note: Str | None = None
    lines: list[CountLineIn] = Field(default_factory=list)


# ------------------------------------------------------------- serialise


def num(v: Decimal | None) -> float | None:
    return None if v is None else float(v)


def iso(v: datetime | None) -> str | None:
    if v is None:
        return None
    return v.astimezone(UTC).isoformat().replace("+00:00", "Z")


def product_ref(p: Product | None) -> dict | None:
    if p is None:
        return None
    return {
        "id": p.id,
        "sku": p.sku,
        "name": p.name,
        "unit": p.unit,
        "archived": p.archived_at is not None,
        "stock": num(p.stock),
        "avg_cost": num(effective_avg(p)),
        "purchase_price": num(p.purchase_price),
        "category_id": p.category_id,
        "category_name": p.category.name if p.category else None,
    }


def product_out(p: Product, *, has_movements: bool, last_receipt_at: datetime | None) -> dict:
    avg = effective_avg(p)
    return {
        "id": p.id,
        "sku": p.sku,
        "name": p.name,
        "category_id": p.category_id,
        "category_name": p.category.name if p.category else None,
        "unit": p.unit,
        "description": p.description,
        "purchase_price": num(p.purchase_price),
        "sale_price": num(p.sale_price),
        "min_stock": num(p.min_stock),
        "stock": num(p.stock),
        "avg_cost": num(avg),
        "stock_value": num(q2(p.stock * avg)),
        "is_low_stock": p.min_stock is not None and p.stock <= p.min_stock,
        "archived": p.archived_at is not None,
        "archived_at": iso(p.archived_at),
        "created_at": iso(p.created_at),
        "updated_at": iso(p.updated_at),
        "has_movements": has_movements,
        "last_receipt_at": iso(last_receipt_at),
    }


def doc_ref(d: Document | None) -> dict | None:
    if d is None:
        return None
    return {"id": d.id, "kind": d.kind, "number": d.number, "posted_at": iso(d.posted_at)}


def line_value(doc: Document, ln: DocumentLine) -> Decimal:
    if ln.qty is None:
        return Decimal(0)
    if doc.kind in ("receipt", "receipt_reversal"):
        return ln.qty * (ln.price or 0)
    cost = ln.unit_cost
    if cost is None or doc.status == "draft":
        cost = effective_avg(ln.product) if ln.product is not None else Decimal(0)
    return ln.qty * cost


def doc_total(doc: Document) -> Decimal:
    return q2(sum((line_value(doc, ln) for ln in doc.lines), Decimal(0)))


def doc_summary(doc: Document) -> dict:
    out = {
        "id": doc.id,
        "kind": doc.kind,
        "number": doc.number,
        "status": doc.status,
        "created_at": iso(doc.created_at),
        "posted_at": iso(doc.posted_at),
        "date": iso(doc.posted_at or doc.created_at),
        "note": doc.note,
        "line_count": len(doc.lines),
        "total": num(doc_total(doc)),
        "supplier": doc.supplier,
        "reason": doc.reason,
        "reversal": doc_ref(doc.reversed_by),
        "reverses": doc_ref(doc.reverses),
    }
    return out


def doc_detail(doc: Document) -> dict:
    out = doc_summary(doc)
    lines = []
    for ln in doc.lines:
        item: dict[str, Any] = {
            "id": ln.id,
            "product": product_ref(ln.product),
            "qty": num(ln.qty),
            "total": num(q2(line_value(doc, ln))),
        }
        if doc.kind in ("receipt", "receipt_reversal"):
            item["price"] = num(ln.price)
        else:
            cost = ln.unit_cost
            if cost is None or doc.status == "draft":
                cost = effective_avg(ln.product) if ln.product is not None else None
            item["unit_cost"] = num(cost)
        lines.append(item)
    out["lines"] = lines
    return out


def movement_out(m: Movement) -> dict:
    return {
        "id": m.id,
        "at": iso(m.at),
        "type": m.type,
        "document": {"id": m.document.id, "kind": m.document.kind, "number": m.document.number},
        "product": product_ref(m.product),
        "qty_change": num(m.qty_change),
        "balance_after": num(m.balance_after),
        "unit_cost": num(m.unit_cost),
        "value_change": num(q2(m.value_change)),
    }
