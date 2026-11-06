"""Accounts, sessions, demo lifecycle and rate limiting."""

import logging
import secrets
from datetime import timedelta

from fastapi import Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app import clock
from app.config import get_settings
from app.errors import AppError
from app.models import AuthEvent, ExpiredDemoSession, User
from app.models import Session as UserSession
from app.security import SESSION_COOKIE, new_session_token, token_hash

logger = logging.getLogger("app.accounts")


def start_session(db: Session, user: User, response: Response) -> None:
    settings = get_settings()
    now = clock.now()
    if user.is_demo and user.demo_expires_at is not None:
        expires = user.demo_expires_at
    else:
        expires = now + timedelta(days=settings.session_days)
    token = new_session_token()
    db.add(UserSession(token_hash=token_hash(token), user_id=user.id, created_at=now, expires_at=expires))
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max(60, int((expires - now).total_seconds())),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", samesite="lax", httponly=True)


def delete_account(db: Session, user: User) -> None:
    """Delete an account and all its data (FK cascades)."""
    db.execute(delete(User).where(User.id == user.id))


def expire_demo(db: Session, user: User) -> None:
    """Delete an expired demo, remembering its sessions so the client sees demo-expired."""
    now = clock.now()
    hashes = db.scalars(select(UserSession.token_hash).where(UserSession.user_id == user.id)).all()
    for h in hashes:
        db.merge(ExpiredDemoSession(token_hash=h, expired_at=now))
    delete_account(db, user)


def cleanup_expired(db: Session) -> int:
    """Delete demos past their expiry and purge stale technical rows. Returns demos deleted."""
    now = clock.now()
    expired = db.scalars(select(User).where(User.is_demo.is_(True), User.demo_expires_at <= now)).all()
    for u in expired:
        expire_demo(db, u)
    db.execute(delete(UserSession).where(UserSession.expires_at <= now))
    db.execute(delete(ExpiredDemoSession).where(ExpiredDemoSession.expired_at <= now - timedelta(days=7)))
    db.execute(delete(AuthEvent).where(AuthEvent.created_at <= now - timedelta(days=1)))
    db.commit()
    if expired:
        logger.info("Deleted %d expired demo workspace(s)", len(expired))
    return len(expired)


# ----------------------------------------------------------------------- rate limits


def _count(db: Session, kind: str, since, *, email: str | None = None, ip: str | None = None) -> int:
    stmt = (
        select(func.count())
        .select_from(AuthEvent)
        .where(AuthEvent.kind == kind, AuthEvent.created_at > since)
    )
    if email is not None:
        stmt = stmt.where(AuthEvent.email == email)
    if ip is not None:
        stmt = stmt.where(AuthEvent.ip == ip)
    return db.scalar(stmt) or 0


def check_login_allowed(db: Session, email: str, ip: str) -> None:
    s = get_settings()
    window = timedelta(minutes=s.login_window_minutes)
    since = clock.now() - window
    if (
        _count(db, "login_failed", since, email=email) >= s.login_max_failures_per_email
        or _count(db, "login_failed", since, ip=ip) >= s.login_max_failures_per_ip
    ):
        raise AppError(
            429,
            "too_many_attempts",
            "Too many failed sign-in attempts. Try again in a few minutes.",
            retry_after=int(window.total_seconds()),
        )


def record_login_failure(db: Session, email: str, ip: str) -> None:
    db.add(AuthEvent(kind="login_failed", email=email, ip=ip, created_at=clock.now()))
    db.commit()


def clear_login_failures(db: Session, email: str) -> None:
    db.execute(delete(AuthEvent).where(AuthEvent.kind == "login_failed", AuthEvent.email == email))


def check_demo_allowed(db: Session, ip: str) -> None:
    s = get_settings()
    since = clock.now() - timedelta(hours=1)
    if (
        _count(db, "demo_created", since, ip=ip) >= s.demo_rate_limit_per_hour
        or _count(db, "demo_created", since) >= s.demo_global_limit_per_hour
    ):
        raise AppError(
            429,
            "rate_limited",
            "Too many demo workspaces were started from your network. Try again later or sign up.",
            retry_after=3600,
        )


def create_demo_user(db: Session, ip: str) -> User:
    now = clock.now()
    s = get_settings()
    user = User(
        email=f"demo-{secrets.token_hex(3)}{secrets.token_hex(1)}@demo.inventory.app",
        password_hash=None,
        is_demo=True,
        demo_expires_at=now + timedelta(hours=s.demo_lifetime_hours),
        created_at=now,
    )
    db.add(user)
    db.add(AuthEvent(kind="demo_created", ip=ip, created_at=now))
    db.flush()
    return user
