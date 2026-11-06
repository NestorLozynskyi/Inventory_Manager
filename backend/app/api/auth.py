from fastapi import APIRouter, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import clock
from app.api.schemas import SignIn, SignUp, iso
from app.deps import SessionDep, TzDep, UserDep, client_ip, find_session
from app.errors import AppError, field_error
from app.models import User
from app.security import hash_password, verify_password
from app.services import accounts
from app.services.demo_seed import seed_demo

router = APIRouter(prefix="/api/auth", tags=["auth"])


def me_out(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "is_demo": u.is_demo,
        "demo_expires_at": iso(u.demo_expires_at),
        "currency": u.currency,
        "created_at": iso(u.created_at),
    }


def _end_current_demo(db, request: Request) -> None:
    """Signing up/in from a demo session ends that demo (demo data is never transferred)."""
    sess = find_session(db, request)
    if sess is not None and sess.user.is_demo:
        accounts.delete_account(db, sess.user)


@router.post("/sign-up", status_code=status.HTTP_201_CREATED)
def sign_up(body: SignUp, request: Request, response: Response, db: SessionDep) -> dict:
    if db.scalar(select(User.id).where(User.email == body.email)) is not None:
        raise AppError(
            409,
            "email_taken",
            "An account with this email already exists.",
            [field_error("email", "An account with this email already exists.", "email_taken")],
        )
    _end_current_demo(db, request)
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        is_demo=False,
        created_at=clock.now(),
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise AppError(
            409,
            "email_taken",
            "An account with this email already exists.",
            [field_error("email", "An account with this email already exists.", "email_taken")],
        ) from e
    accounts.start_session(db, user, response)
    db.commit()
    return me_out(user)


@router.post("/sign-in")
def sign_in(body: SignIn, request: Request, response: Response, db: SessionDep) -> dict:
    ip = client_ip(request)
    accounts.check_login_allowed(db, body.email, ip)
    user = db.scalar(select(User).where(User.email == body.email, User.is_demo.is_(False)))
    if user is None or not verify_password(user.password_hash, body.password):
        accounts.record_login_failure(db, body.email, ip)
        raise AppError(401, "invalid_credentials", "The email or password is incorrect.")
    _end_current_demo(db, request)
    accounts.clear_login_failures(db, body.email)
    accounts.start_session(db, user, response)
    db.commit()
    return me_out(user)


@router.post("/demo", status_code=status.HTTP_201_CREATED)
def start_demo(request: Request, response: Response, db: SessionDep, tz: TzDep) -> dict:
    ip = client_ip(request)
    accounts.check_demo_allowed(db, ip)
    _end_current_demo(db, request)
    user = accounts.create_demo_user(db, ip)
    seed_demo(db, user, clock.now(), tz)
    accounts.start_session(db, user, response)
    db.commit()
    return me_out(user)


@router.post("/sign-out")
def sign_out(request: Request, response: Response, db: SessionDep) -> dict:
    sess = find_session(db, request)
    was_demo = False
    if sess is not None:
        if sess.user.is_demo:
            was_demo = True
            accounts.delete_account(db, sess.user)
        else:
            db.delete(sess)
        db.commit()
    accounts.clear_cookie(response)
    return {"was_demo": was_demo}


@router.get("/me")
def me(user: UserDep) -> dict:
    return me_out(user)
