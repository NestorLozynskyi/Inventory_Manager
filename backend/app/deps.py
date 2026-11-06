from collections.abc import Iterator
from datetime import tzinfo
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.db import get_session
from app.errors import AppError
from app.models import ExpiredDemoSession, User
from app.models import Session as UserSession
from app.security import SESSION_COOKIE, token_hash

SessionDep = Annotated[Session, Depends(get_session)]


def get_tz(request: Request) -> tzinfo:
    name = request.headers.get("x-timezone") or "UTC"
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError, ValueError:
        return ZoneInfo("UTC")


TzDep = Annotated[tzinfo, Depends(get_tz)]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def find_session(db: Session, request: Request) -> UserSession | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    return db.get(UserSession, token_hash(token))


def current_user(request: Request, db: SessionDep) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise AppError(401, "unauthenticated", "Sign in to continue.")
    h = token_hash(token)
    sess = db.get(UserSession, h)
    now = clock.now()
    if sess is None:
        if db.get(ExpiredDemoSession, h) is not None:
            raise AppError(401, "demo_expired", "This demo has expired and its data was deleted.")
        raise AppError(401, "unauthenticated", "Sign in to continue.")
    user = sess.user
    if user.is_demo and user.demo_expires_at is not None and user.demo_expires_at <= now:
        from app.services.accounts import expire_demo

        expire_demo(db, user)
        db.commit()
        raise AppError(401, "demo_expired", "This demo has expired and its data was deleted.")
    if sess.expires_at <= now:
        db.delete(sess)
        db.commit()
        raise AppError(401, "unauthenticated", "Your session has expired. Sign in again.")
    return user


UserDep = Annotated[User, Depends(current_user)]


def lock_user(db: Session, user: User) -> None:
    """Serialise writes of one account where needed (e.g. document numbering)."""
    db.execute(select(User.id).where(User.id == user.id).with_for_update())


__all__ = ["SessionDep", "TzDep", "UserDep", "current_user", "get_session", "Iterator"]
