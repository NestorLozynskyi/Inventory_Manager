from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

QTY = Numeric(14, 3)
MONEY = Numeric(12, 2)
COST = Numeric(14, 4)
VALUE = Numeric(18, 6)
TS = DateTime(timezone=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    demo_expires_at: Mapped[datetime | None] = mapped_column(TS)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)

    __table_args__ = (Index("ix_users_demo_expiry", "demo_expires_at"),)


class Session(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(TS, nullable=False)

    user: Mapped[User] = relationship()


class ExpiredDemoSession(Base):
    """Tombstone of a session whose demo workspace was deleted on expiry (to show demo-expired)."""

    __tablename__ = "expired_demo_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    expired_at: Mapped[datetime] = mapped_column(TS, nullable=False)


class AuthEvent(Base):
    """Failed sign-ins and demo creations, used for rate limiting."""

    __tablename__ = "auth_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # login_failed | demo_created
    email: Mapped[str | None] = mapped_column(String(254))
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)

    __table_args__ = (
        Index("ix_auth_events_kind_email", "kind", "email", "created_at"),
        Index("ix_auth_events_kind_ip", "kind", "ip", "created_at"),
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)

    __table_args__ = (Index("uq_categories_user_name", "user_id", func.lower(name), unique=True),)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sku: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), index=True)
    unit: Mapped[str] = mapped_column(String(8), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    purchase_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    sale_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    min_stock: Mapped[Decimal | None] = mapped_column(QTY)
    stock: Mapped[Decimal] = mapped_column(QTY, nullable=False, default=Decimal(0))
    avg_cost: Mapped[Decimal | None] = mapped_column(COST)
    archived_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False)

    category: Mapped[Category | None] = relationship(lazy="joined")

    __table_args__ = (
        Index("uq_products_user_sku", "user_id", func.lower(sku), unique=True),
        Index("ix_products_user", "user_id"),
        CheckConstraint("stock >= 0", name="ck_products_stock_non_negative"),
    )


class DocCounter(Base):
    __tablename__ = "doc_counters"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    prefix: Mapped[str] = mapped_column(String(4), primary_key=True)
    last: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Document(Base):
    """Receipts, write-offs, reversals and stock counts share one table."""

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # receipt | write_off | receipt_reversal | write_off_reversal | stock_count
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    number: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)  # draft | posted | reversed
    supplier: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    reason: Mapped[str | None] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reverses_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), unique=True
    )
    scope_category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    scope_label: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    posted_at: Mapped[datetime | None] = mapped_column(TS)

    lines: Mapped[list[DocumentLine]] = relationship(
        back_populates="document",
        order_by="DocumentLine.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    reverses: Mapped[Document | None] = relationship(
        remote_side="Document.id", foreign_keys=[reverses_id], back_populates="reversed_by"
    )
    reversed_by: Mapped[Document | None] = relationship(
        foreign_keys=[reverses_id], back_populates="reverses", uselist=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "number", name="uq_documents_user_number"),
        Index("ix_documents_user_kind", "user_id", "kind"),
    )


class DocumentLine(Base):
    __tablename__ = "document_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), index=True)
    qty: Mapped[Decimal | None] = mapped_column(QTY)
    price: Mapped[Decimal | None] = mapped_column(MONEY)  # receipt line price
    unit_cost: Mapped[Decimal | None] = mapped_column(COST)  # write-off / count cost at posting
    book_qty: Mapped[Decimal | None] = mapped_column(QTY)  # stock count: stock at posting
    actual_qty: Mapped[Decimal | None] = mapped_column(QTY)  # stock count: counted quantity

    document: Mapped[Document] = relationship(back_populates="lines")
    product: Mapped[Product | None] = relationship(lazy="joined")


class Movement(Base):
    """One stock change of one product caused by a posted document."""

    __tablename__ = "movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(12), nullable=False)  # receipt|write_off|stock_count|reversal
    at: Mapped[datetime] = mapped_column(TS, nullable=False)
    qty_change: Mapped[Decimal] = mapped_column(QTY, nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(QTY, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(COST, nullable=False)
    value_change: Mapped[Decimal] = mapped_column(VALUE, nullable=False)
    avg_cost_after: Mapped[Decimal] = mapped_column(COST, nullable=False)

    document: Mapped[Document] = relationship(lazy="joined")
    product: Mapped[Product] = relationship(lazy="joined")

    __table_args__ = (
        Index("ix_movements_user_at", "user_id", "at", "id"),
        Index("ix_movements_product_at", "product_id", "at", "id"),
    )
