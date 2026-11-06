from fastapi import APIRouter
from sqlalchemy import text

from app.db import get_engine
from app.errors import error_response

router = APIRouter(tags=["health"])


@router.get("/healthz", include_in_schema=False)
def healthz():
    """Container healthcheck: process is up and the database answers.

    Deliberately outside /api, so the public Caddy proxy does not expose it.
    """
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        return error_response(503, "unavailable", "Database is not reachable.")
    return {"status": "ok"}
