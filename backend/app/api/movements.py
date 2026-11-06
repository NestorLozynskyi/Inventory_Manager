from datetime import date
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.api.documents import day_end, day_start
from app.api.schemas import movement_out
from app.deps import SessionDep, TzDep, UserDep
from app.models import Document, Movement, Product

router = APIRouter(prefix="/api/movements", tags=["history"])


@router.get("")
def list_movements(
    user: UserDep,
    db: SessionDep,
    tz: TzDep,
    search: str = "",
    type: Literal["receipt", "write_off", "stock_count", "reversal"] | None = None,
    product_id: int | None = None,
    category_id: str | None = None,
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = (
        select(Movement)
        .join(Product, Product.id == Movement.product_id)
        .join(Document, Document.id == Movement.document_id)
        .where(Movement.user_id == user.id)
    )
    if type:
        stmt = stmt.where(Movement.type == type)
    if product_id is not None:
        stmt = stmt.where(Movement.product_id == product_id)
    if category_id == "none":
        stmt = stmt.where(Product.category_id.is_(None))
    elif category_id:
        try:
            stmt = stmt.where(Product.category_id == int(category_id))
        except ValueError:
            stmt = stmt.where(False)
    if search.strip():
        like = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Product.name).like(like),
                func.lower(Product.sku).like(like),
                func.lower(Document.number).like(like),
            )
        )
    if from_:
        stmt = stmt.where(Movement.at >= day_start(from_, tz))
    if to:
        stmt = stmt.where(Movement.at < day_end(to, tz))
    total = db.scalar(select(func.count()).select_from(stmt.with_only_columns(Movement.id).subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Movement.at.desc(), Movement.id.desc()).limit(limit).offset(offset)
    ).unique()
    return {"items": [movement_out(m) for m in rows], "total": total}
