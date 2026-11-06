"""Single source of "now" so tests can control time (demo expiry, posting dates)."""

from collections.abc import Callable
from datetime import UTC, datetime


def _system_now() -> datetime:
    return datetime.now(UTC)


_now: Callable[[], datetime] = _system_now


def now() -> datetime:
    return _now()


def set_now(fn: Callable[[], datetime] | None) -> None:
    """Override the clock (tests). Pass None to restore the system clock."""
    global _now
    _now = fn or _system_now
