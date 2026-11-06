"""Background deletion of expired demo workspaces (runs inside the API process)."""

import asyncio
import logging

from sqlalchemy import text

from app.config import get_settings
from app.db import get_sessionmaker
from app.services.accounts import cleanup_expired

logger = logging.getLogger("app.cleanup")
_LOCK_KEY = 7_311_001  # pg advisory lock: only one worker cleans at a time


def run_once() -> int:
    with get_sessionmaker()() as db:
        got = db.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": _LOCK_KEY}).scalar()
        if not got:
            return 0
        return cleanup_expired(db)


async def cleanup_loop() -> None:
    interval = get_settings().cleanup_interval_seconds
    while True:
        try:
            await asyncio.to_thread(run_once)
        except Exception:  # keep the loop alive; DB may be temporarily unavailable
            logger.exception("Demo cleanup failed")
        await asyncio.sleep(interval)
