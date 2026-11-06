from datetime import tzinfo
from typing import Literal

from fastapi import APIRouter, Query, status
from sqlalchemy import Select, and_, case, exists, func, or_, select
from sqlalchemy.exc import IntegrityError

from app import clock
from app.api.csvutil import csv_response
from app.api.schemas import ProductIn, movement_out, product_out
from app.deps import SessionDep, TzDep, UserDep
from app.errors import AppError, field_error, not_found, validation_failed
from app.models import Category, Movement, Product
from app.services.inventory import qty_error

router = APIRouter(prefix="/api/products", tags=["products"])

Status = Literal["active", "archived", "all"]
Sort = Literal["name", "sku", "category", "stock", "value", "updated"]


def _dup() -> AppError:
    return AppError(
        409,
        "duplicate_sku",
        "A product with this SKU already exists.",
        [field_error("sku", "A product with this SKU already exists.", "duplicate_sku")],
    )


def _meta(db, ids: list[int]) -> tuple[set[int], dict[int, object]]:
    if not ids:
        return set(), {}
    moved = set(db.scalars(select(Movement.product_id).where(Movement.product_id.in_(ids)).distinct()))
    last = dict(
        db.execute(
            select(Movement.product_id, func.max(Movement.at))
            .where(Movement.product_id.in_(ids), Movement.type == "receipt")
            .group_by(Movement.product_id)
        ).all()
    )
    return moved, last


def _out_many(db, products: list[Product]) -> list[dict]:
    moved, last = _meta(db, [p.id for p in products])
    return [product_out(p, has_movements=p.id in moved, last_receipt_at=last.get(p.id)) for p in products]


def _get(db, user, pid: int, *, lock: bool = False) -> Product:
    stmt = select(Product).where(Product.id == pid, Product.user_id == user.id)
    if lock:
        stmt = stmt.with_for_update(of=Product)
    p = db.scalar(stmt)
    if p is None:
        raise not_found("Product")
    return p


def _filtered(user, search: str, category_id: str | None, status_: Status, low_stock: bool) -> Select:
    stmt = select(Product).where(Product.user_id == user.id)
    if status_ == "active":
        stmt = stmt.where(Product.archived_at.is_(None))
    elif status_ == "archived":
        stmt = stmt.where(Product.archived_at.is_not(None))
    if search.strip():
        like = f"%{search.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Product.name).like(like), func.lower(Product.sku).like(like)))
    if category_id == "none":
        stmt = stmt.where(Product.category_id.is_(None))
    elif category_id:
        try:
            stmt = stmt.where(Product.category_id == int(category_id))
        except ValueError:
            stmt = stmt.where(False)
    if low_stock:
        stmt = stmt.where(Product.min_stock.is_not(None), Product.stock <= Product.min_stock)
    return stmt


def _sorted(stmt: Select, sort: Sort, order: str) -> Select:
    value = Product.stock * func.coalesce(Product.avg_cost, Product.purchase_price)
    key = {
        "name": func.lower(Product.name),
        "sku": func.lower(Product.sku),
        "category": func.lower(func.coalesce(Category.name, "")),
        "stock": Product.stock,
        "value": value,
        "updated": Product.updated_at,
    }[sort]
    if sort == "category":
        stmt = stmt.outerjoin(Category, Category.id == Product.category_id)
    col = key.desc() if order == "desc" else key.asc()
    return stmt.order_by(col, func.lower(Product.name), Product.id)


def _validate(db, user, body: ProductIn, existing: Product | None) -> None:
    details = []
    if (
        body.category_id is not None
        and db.scalar(select(Category.id).where(Category.id == body.category_id, Category.user_id == user.id))
        is None
    ):
        details.append(field_error("category_id", "Choose an existing category.", "not_found"))
    if body.min_stock is not None:
        err = qty_error(body.unit, body.min_stock, allow_zero=True)
        if err:
            details.append(field_error("min_stock", err.replace("quantity", "minimum stock"), "invalid_qty"))
    if existing is not None and existing.unit != body.unit:
        has = db.scalar(select(exists().where(Movement.product_id == existing.id)))
        if has or existing.stock != 0:
            details.append(
                field_error(
                    "unit",
                    "The unit can't be changed after stock movements are recorded.",
                    "unit_locked",
                )
            )
    if details:
        raise validation_failed(details)
    sku_taken = select(Product.id).where(
        Product.user_id == user.id, func.lower(Product.sku) == body.sku.lower()
    )
    if existing is not None:
        sku_taken = sku_taken.where(Product.id != existing.id)
    if db.scalar(sku_taken) is not None:
        raise _dup()


@router.get("")
def list_products(
    user: UserDep,
    db: SessionDep,
    search: str = "",
    category_id: str | None = None,
    status: Status = "active",
    low_stock: bool = False,
    sort: Sort = "name",
    order: Literal["asc", "desc"] = "asc",
) -> dict:
    items = list(
        db.scalars(_sorted(_filtered(user, search, category_id, status, low_stock), sort, order)).unique()
    )
    low = and_(
        Product.min_stock.is_not(None),
        Product.stock <= Product.min_stock,
        Product.archived_at.is_(None),
    )
    a, ar, al, lo = db.execute(
        select(
            func.count().filter(Product.archived_at.is_(None)),
            func.count().filter(Product.archived_at.is_not(None)),
            func.count(),
            func.count().filter(low),
        ).where(Product.user_id == user.id)
    ).one()
    return {
        "items": _out_many(db, items),
        "counts": {"active": a, "archived": ar, "all": al, "low_stock": lo},
    }


@router.get("/export.csv")
def export_products(
    user: UserDep,
    db: SessionDep,
    tz: TzDep,
    search: str = "",
    category_id: str | None = None,
    status: Status = "active",
    low_stock: bool = False,
    sort: Sort = "name",
    order: Literal["asc", "desc"] = "asc",
):
    items = _out_many(
        db,
        list(
            db.scalars(_sorted(_filtered(user, search, category_id, status, low_stock), sort, order)).unique()
        ),
    )
    today = clock.now().astimezone(tz).date().isoformat()
    return csv_response(
        f"products-{today}.csv",
        [
            "SKU",
            "Name",
            "Category",
            "Unit",
            "Stock",
            "Min stock",
            "Avg cost",
            "Stock value",
            "Purchase price",
            "Sale price",
            "Status",
        ],
        [
            [
                p["sku"],
                p["name"],
                p["category_name"] or "No category",
                p["unit"],
                _n(p["stock"]),
                _n(p["min_stock"]),
                f"{p['avg_cost']:.2f}",
                f"{p['stock_value']:.2f}",
                f"{p['purchase_price']:.2f}",
                f"{p['sale_price']:.2f}",
                "Archived" if p["archived"] else ("Low stock" if p["is_low_stock"] else "Active"),
            ]
            for p in items
        ],
    )


def _n(v: float | None) -> str:
    if v is None:
        return ""
    return f"{v:.3f}".rstrip("0").rstrip(".")


@router.post("", status_code=status.HTTP_201_CREATED)
def create_product(body: ProductIn, user: UserDep, db: SessionDep) -> dict:
    _validate(db, user, body, None)
    now = clock.now()
    p = Product(
        user_id=user.id,
        sku=body.sku,
        name=body.name,
        category_id=body.category_id,
        unit=body.unit,
        description=body.description,
        purchase_price=body.purchase_price,
        sale_price=body.sale_price,
        min_stock=body.min_stock,
        created_at=now,
        updated_at=now,
    )
    db.add(p)
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise _dup() from e
    db.commit()
    db.refresh(p)
    return _out_many(db, [p])[0]


@router.get("/{pid}")
def get_product(pid: int, user: UserDep, db: SessionDep) -> dict:
    return _out_many(db, [_get(db, user, pid)])[0]


@router.put("/{pid}")
def update_product(pid: int, body: ProductIn, user: UserDep, db: SessionDep) -> dict:
    p = _get(db, user, pid, lock=True)
    _validate(db, user, body, p)
    p.sku, p.name, p.category_id, p.unit = body.sku, body.name, body.category_id, body.unit
    p.description, p.purchase_price, p.sale_price, p.min_stock = (
        body.description,
        body.purchase_price,
        body.sale_price,
        body.min_stock,
    )
    p.updated_at = clock.now()
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise _dup() from e
    db.commit()
    db.refresh(p)
    return _out_many(db, [p])[0]


@router.post("/{pid}/archive")
def archive_product(pid: int, user: UserDep, db: SessionDep) -> dict:
    p = _get(db, user, pid, lock=True)
    if p.archived_at is None:
        p.archived_at = clock.now()
        p.updated_at = p.archived_at
    db.commit()
    db.refresh(p)
    return _out_many(db, [p])[0]


@router.post("/{pid}/restore")
def restore_product(pid: int, user: UserDep, db: SessionDep) -> dict:
    p = _get(db, user, pid, lock=True)
    if p.archived_at is not None:
        p.archived_at = None
        p.updated_at = clock.now()
    db.commit()
    db.refresh(p)
    return _out_many(db, [p])[0]


@router.get("/{pid}/movements")
def product_movements(
    pid: int,
    user: UserDep,
    db: SessionDep,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    p = _get(db, user, pid)
    total = db.scalar(select(func.count(Movement.id)).where(Movement.product_id == p.id)) or 0
    rows = db.scalars(
        select(Movement)
        .where(Movement.product_id == p.id)
        .order_by(Movement.at.desc(), Movement.id.desc())
        .limit(limit)
        .offset(offset)
    ).unique()
    return {"items": [movement_out(m) for m in rows], "total": total}


_ = (tzinfo, case)
