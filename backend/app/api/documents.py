from datetime import date, datetime, time, timedelta, tzinfo
from typing import Literal

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app import clock
from app.api.schemas import ReceiptIn, ReverseIn, WriteOffIn, doc_detail, doc_summary
from app.deps import SessionDep, TzDep, UserDep
from app.errors import AppError, field_error, not_found, validation_failed
from app.models import Document, DocumentLine, Product, User
from app.services import inventory as inv


def day_start(d: date, tz: tzinfo) -> datetime:
    return datetime.combine(d, time.min, tz)


def day_end(d: date, tz: tzinfo) -> datetime:
    return datetime.combine(d + timedelta(days=1), time.min, tz)


def _load(db, user: User, doc_id: int, kinds: list[str]) -> Document:
    doc = db.scalar(
        select(Document)
        .where(Document.id == doc_id, Document.user_id == user.id, Document.kind.in_(kinds))
        .options(
            selectinload(Document.lines),
            selectinload(Document.reversed_by),
            selectinload(Document.reverses),
        )
    )
    if doc is None:
        raise not_found("Document")
    return doc


def _lines_from(db, user: User, body, *, with_price: bool) -> list[DocumentLine]:
    """Build draft lines; products must belong to the account. Incomplete lines are allowed in drafts."""
    ids = {ln.product_id for ln in body.lines if ln.product_id is not None}
    products = (
        {p.id: p for p in db.scalars(select(Product).where(Product.user_id == user.id, Product.id.in_(ids)))}
        if ids
        else {}
    )
    details = []
    out = []
    for i, ln in enumerate(body.lines):
        p = products.get(ln.product_id) if ln.product_id is not None else None
        if ln.product_id is not None and p is None:
            details.append(field_error(f"lines.{i}.product_id", "Choose a product.", "not_found"))
        if ln.qty is not None:
            err = inv.qty_error(p.unit if p else None, ln.qty, allow_zero=True)
            if err:
                details.append(field_error(f"lines.{i}.qty", err, "invalid_qty"))
        out.append(DocumentLine(product_id=ln.product_id, qty=ln.qty, price=ln.price if with_price else None))
    if details:
        raise validation_failed(details)
    return out


def _period(stmt, tz: tzinfo, from_: date | None, to: date | None):
    when = func.coalesce(Document.posted_at, Document.created_at)
    if from_:
        stmt = stmt.where(when >= day_start(from_, tz))
    if to:
        stmt = stmt.where(when < day_end(to, tz))
    return stmt


def make_router(kind: str) -> APIRouter:
    is_receipt = kind == "receipt"
    rev_kind = "receipt_reversal" if is_receipt else "write_off_reversal"
    path = "/api/receipts" if is_receipt else "/api/write-offs"
    label = "receipt" if is_receipt else "write-off"
    Body = ReceiptIn if is_receipt else WriteOffIn
    router = APIRouter(prefix=path, tags=[label + "s"])

    @router.get("")
    def list_docs(
        user: UserDep,
        db: SessionDep,
        tz: TzDep,
        search: str = "",
        status: Literal["draft", "posted", "reversed", "reversal"] | None = None,
        reason: str | None = None,
        from_: date | None = Query(None, alias="from"),
        to: date | None = None,
    ) -> dict:
        kinds = [kind, rev_kind]
        stmt = select(Document).where(Document.user_id == user.id, Document.kind.in_(kinds))
        if status == "reversal":
            stmt = stmt.where(Document.kind == rev_kind)
        elif status:
            stmt = stmt.where(Document.kind == kind, Document.status == status)
        if reason and not is_receipt:
            stmt = stmt.where(Document.reason == reason)
        if search.strip():
            like = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(Document.number).like(like),
                    func.lower(Document.supplier).like(like),
                    func.lower(Document.note).like(like),
                )
            )
        stmt = _period(stmt, tz, from_, to)
        stmt = stmt.options(
            selectinload(Document.lines),
            selectinload(Document.reversed_by),
            selectinload(Document.reverses),
        )
        stmt = stmt.order_by(
            func.coalesce(Document.posted_at, Document.created_at).desc(), Document.id.desc()
        )
        return {"items": [doc_summary(d) for d in db.scalars(stmt).unique()]}

    @router.post("", status_code=status.HTTP_201_CREATED)
    def create_doc(body: Body, user: UserDep, db: SessionDep) -> dict:  # type: ignore[valid-type]
        doc = Document(
            user_id=user.id,
            kind=kind,
            number=inv.next_number(db, user.id, kind),
            status="draft",
            note=body.note,
            created_at=clock.now(),
        )
        if is_receipt:
            doc.supplier = body.supplier
        else:
            doc.reason = body.reason
        db.add(doc)
        inv.replace_lines(doc, _lines_from(db, user, body, with_price=is_receipt))
        db.commit()
        return doc_detail(_load(db, user, doc.id, [kind]))

    @router.get("/{doc_id}")
    def get_doc(doc_id: int, user: UserDep, db: SessionDep) -> dict:
        return doc_detail(_load(db, user, doc_id, [kind, rev_kind]))

    @router.put("/{doc_id}")
    def update_doc(doc_id: int, body: Body, user: UserDep, db: SessionDep) -> dict:  # type: ignore[valid-type]
        doc = inv.lock_document(db, user, doc_id, [kind])
        inv.require_draft(doc)
        doc.note = body.note
        if is_receipt:
            doc.supplier = body.supplier
        else:
            doc.reason = body.reason
        inv.replace_lines(doc, _lines_from(db, user, body, with_price=is_receipt))
        db.commit()
        db.expire_all()
        return doc_detail(_load(db, user, doc_id, [kind]))

    @router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_doc(doc_id: int, user: UserDep, db: SessionDep) -> Response:
        doc = inv.lock_document(db, user, doc_id, [kind])
        inv.require_draft(doc)
        db.delete(doc)
        db.commit()
        return Response(status_code=204)

    @router.post("/{doc_id}/post")
    def post_doc(doc_id: int, user: UserDep, db: SessionDep) -> dict:
        if is_receipt:
            inv.post_receipt(db, user, doc_id)
        else:
            inv.post_write_off(db, user, doc_id)
        db.commit()
        db.expire_all()
        return doc_detail(_load(db, user, doc_id, [kind]))

    @router.post("/{doc_id}/reverse", status_code=status.HTTP_201_CREATED)
    def reverse_doc(doc_id: int, user: UserDep, db: SessionDep, body: ReverseIn | None = None) -> dict:
        rv = inv.reverse_document(db, user, doc_id, note=(body.note if body else ""))
        db.commit()
        db.expire_all()
        return doc_detail(_load(db, user, rv.id, [rev_kind]))

    return router


receipts_router = make_router("receipt")
write_offs_router = make_router("write_off")

reversals_router = APIRouter(prefix="/api/reversals", tags=["reversals"])


@reversals_router.get("/{doc_id}")
def get_reversal(doc_id: int, user: UserDep, db: SessionDep) -> dict:
    return doc_detail(_load(db, user, doc_id, ["receipt_reversal", "write_off_reversal"]))


__all__ = ["AppError", "receipts_router", "write_offs_router", "reversals_router"]
