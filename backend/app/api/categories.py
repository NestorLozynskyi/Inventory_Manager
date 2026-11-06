from fastapi import APIRouter, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app import clock
from app.api.schemas import CategoryIn
from app.deps import SessionDep, UserDep
from app.errors import AppError, field_error, not_found
from app.models import Category, Product

router = APIRouter(prefix="/api/categories", tags=["categories"])


def _dup() -> AppError:
    return AppError(
        409,
        "duplicate_name",
        "A category with this name already exists.",
        [field_error("name", "A category with this name already exists.", "duplicate_name")],
    )


def _out(db, c: Category) -> dict:
    total, active = db.execute(
        select(func.count(Product.id), func.count(Product.id).filter(Product.archived_at.is_(None))).where(
            Product.category_id == c.id
        )
    ).one()
    return {"id": c.id, "name": c.name, "product_count": total, "active_product_count": active}


def _get(db, user, cid: int) -> Category:
    c = db.scalar(select(Category).where(Category.id == cid, Category.user_id == user.id))
    if c is None:
        raise not_found("Category")
    return c


def _name_taken(db, user, name: str, exclude: int | None = None) -> bool:
    stmt = select(Category.id).where(Category.user_id == user.id, func.lower(Category.name) == name.lower())
    if exclude is not None:
        stmt = stmt.where(Category.id != exclude)
    return db.scalar(stmt) is not None


@router.get("")
def list_categories(user: UserDep, db: SessionDep) -> list[dict]:
    rows = db.execute(
        select(
            Category,
            func.count(Product.id),
            func.count(Product.id).filter(Product.archived_at.is_(None)),
        )
        .outerjoin(Product, Product.category_id == Category.id)
        .where(Category.user_id == user.id)
        .group_by(Category.id)
        .order_by(func.lower(Category.name))
    ).all()
    return [{"id": c.id, "name": c.name, "product_count": t, "active_product_count": a} for c, t, a in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryIn, user: UserDep, db: SessionDep) -> dict:
    if _name_taken(db, user, body.name):
        raise _dup()
    c = Category(user_id=user.id, name=body.name, created_at=clock.now())
    db.add(c)
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise _dup() from e
    db.commit()
    return _out(db, c)


@router.patch("/{cid}")
def rename_category(cid: int, body: CategoryIn, user: UserDep, db: SessionDep) -> dict:
    c = _get(db, user, cid)
    if _name_taken(db, user, body.name, exclude=c.id):
        raise _dup()
    c.name = body.name
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise _dup() from e
    db.commit()
    return _out(db, c)


@router.delete("/{cid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(cid: int, user: UserDep, db: SessionDep) -> Response:
    c = db.scalar(select(Category).where(Category.id == cid, Category.user_id == user.id).with_for_update())
    if c is None:
        raise not_found("Category")
    used = db.scalar(select(func.count(Product.id)).where(Product.category_id == c.id)) or 0
    if used:
        raise AppError(
            409,
            "category_in_use",
            f"This category is used by {used} product{'s' if used != 1 else ''} and can't be deleted.",
            product_count=used,
        )
    db.delete(c)
    try:
        db.commit()
    except IntegrityError as e:  # a product was assigned concurrently
        db.rollback()
        raise AppError(
            409,
            "category_in_use",
            "This category is used by products and can't be deleted.",
            product_count=1,
        ) from e
    return Response(status_code=204)
