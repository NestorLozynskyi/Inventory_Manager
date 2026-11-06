from decimal import Decimal

from fastapi import APIRouter, Response, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app import clock
from app.api.schemas import StockCountIn, StockCountPatch, doc_summary, num, product_ref
from app.deps import SessionDep, UserDep
from app.errors import field_error, not_found, validation_failed
from app.models import Category, Document, DocumentLine, Product, User
from app.services import inventory as inv
from app.services.inventory import effective_avg, q2, q3

router = APIRouter(prefix="/api/stock-counts", tags=["stock counts"])


def _load(db, user: User, doc_id: int) -> Document:
    doc = db.scalar(
        select(Document)
        .where(Document.id == doc_id, Document.user_id == user.id, Document.kind == "stock_count")
        .options(selectinload(Document.lines))
    )
    if doc is None:
        raise not_found("Stock count")
    return doc


def _line(doc: Document, ln: DocumentLine) -> dict:
    p = ln.product
    if doc.status == "draft":
        book, cost = p.stock, effective_avg(p)
    else:
        book, cost = ln.book_qty, ln.unit_cost
    diff = q3(ln.actual_qty - book) if ln.actual_qty is not None and book is not None else None
    value = q2(diff * cost) if diff is not None and cost is not None else None
    return {
        "id": ln.id,
        "product": product_ref(p),
        "book_qty": num(book),
        "actual_qty": num(ln.actual_qty),
        "difference": num(diff),
        "unit_cost": num(cost),
        "value": num(value),
    }


def _stats(lines: list[dict]) -> dict:
    counted = [x for x in lines if x["actual_qty"] is not None]
    sur = [x for x in counted if (x["difference"] or 0) > 0]
    sho = [x for x in counted if (x["difference"] or 0) < 0]
    sv = q2(sum((Decimal(str(x["value"])) for x in sur), Decimal(0)))
    shv = q2(sum((Decimal(str(x["value"])) for x in sho), Decimal(0)))
    return {
        "line_count": len(lines),
        "counted": len(counted),
        "surplus_count": len(sur),
        "shortage_count": len(sho),
        "surplus_value": num(sv),
        "shortage_value": num(shv),
        "net_value": num(sv + shv),
    }


def _summary(doc: Document) -> dict:
    lines = [_line(doc, ln) for ln in doc.lines]
    out = doc_summary(doc)
    out.pop("supplier", None)
    out.pop("reason", None)
    out.pop("reversal", None)
    out.pop("reverses", None)
    out.pop("total", None)
    out["scope"] = "category" if doc.scope_label and doc.scope_label.startswith("Category") else "all"
    out["scope_label"] = doc.scope_label
    out["category"] = (
        {"id": doc.scope_category_id, "name": doc.scope_label.removeprefix("Category: ")}
        if out["scope"] == "category"
        else None
    )
    out.update(_stats(lines))
    return out, lines  # type: ignore[return-value]


def _detail(doc: Document) -> dict:
    out, lines = _summary(doc)
    out["lines"] = lines
    return out


@router.get("")
def list_counts(user: UserDep, db: SessionDep) -> dict:
    docs = db.scalars(
        select(Document)
        .where(Document.user_id == user.id, Document.kind == "stock_count")
        .options(selectinload(Document.lines))
        .order_by(Document.created_at.desc(), Document.id.desc())
    ).unique()
    return {"items": [_summary(d)[0] for d in docs]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_count(body: StockCountIn, user: UserDep, db: SessionDep) -> dict:
    label = "All active products"
    stmt = select(Product).where(Product.user_id == user.id, Product.archived_at.is_(None))
    if body.category_id is not None:
        cat = db.scalar(select(Category).where(Category.id == body.category_id, Category.user_id == user.id))
        if cat is None:
            raise validation_failed([field_error("category_id", "Choose an existing category.", "not_found")])
        stmt = stmt.where(Product.category_id == cat.id)
        label = f"Category: {cat.name}"
    products = list(db.scalars(stmt.order_by(Product.sku)))
    if not products:
        raise validation_failed(
            [
                field_error(
                    "category_id",
                    "There are no active products to count in this scope.",
                    "empty_scope",
                )
            ]
        )
    doc = Document(
        user_id=user.id,
        kind="stock_count",
        number=inv.next_number(db, user.id, "stock_count"),
        status="draft",
        note=body.note,
        created_at=clock.now(),
        scope_category_id=body.category_id,
        scope_label=label,
    )
    db.add(doc)
    inv.replace_lines(doc, [DocumentLine(product_id=p.id) for p in products])
    db.commit()
    return _detail(_load(db, user, doc.id))


@router.get("/{doc_id}")
def get_count(doc_id: int, user: UserDep, db: SessionDep) -> dict:
    return _detail(_load(db, user, doc_id))


@router.patch("/{doc_id}")
def update_count(doc_id: int, body: StockCountPatch, user: UserDep, db: SessionDep) -> dict:
    doc = inv.lock_document(db, user, doc_id, ["stock_count"])
    inv.require_draft(doc)
    if body.note is not None:
        doc.note = body.note
    by_id = {ln.id: (i, ln) for i, ln in enumerate(doc.lines)}
    details = []
    for k, item in enumerate(body.lines):
        found = by_id.get(item.id)
        if found is None:
            details.append(field_error(f"lines.{k}.id", "Unknown line.", "not_found"))
            continue
        i, ln = found
        if item.actual_qty is not None:
            err = inv.qty_error(ln.product.unit, item.actual_qty, allow_zero=True)
            if err:
                details.append(field_error(f"lines.{k}.actual_qty", err, "invalid_qty"))
                continue
        ln.actual_qty = item.actual_qty
    if details:
        db.rollback()
        raise validation_failed(details)
    db.commit()
    db.expire_all()
    return _detail(_load(db, user, doc_id))


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_count(doc_id: int, user: UserDep, db: SessionDep) -> Response:
    doc = inv.lock_document(db, user, doc_id, ["stock_count"])
    inv.require_draft(doc)
    db.delete(doc)
    db.commit()
    return Response(status_code=204)


@router.post("/{doc_id}/post")
def post_count(doc_id: int, user: UserDep, db: SessionDep) -> dict:
    inv.post_stock_count(db, user, doc_id)
    db.commit()
    db.expire_all()
    return _detail(_load(db, user, doc_id))
