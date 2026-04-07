from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo


WEEKDAY_NAMES: tuple[str, ...] = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)

CHICAGO_TZ = ZoneInfo("America/Chicago")


def normalize_weekly_due_day(value: str | None) -> str | None:
    """Normalize weekly due day to canonical lowercase name."""
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in WEEKDAY_NAMES:
        return normalized
    return None


def chicago_now() -> datetime:
    return datetime.now(CHICAGO_TZ)


def weekday_name_from_datetime(value: datetime) -> str:
    """Return weekday name for datetime (interpreting naive values as UTC)."""
    dt = value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return WEEKDAY_NAMES[dt.weekday()]


def weekday_name_in_chicago(value: datetime) -> str:
    """Return weekday name in Chicago timezone (naive values assumed UTC)."""
    dt = value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return WEEKDAY_NAMES[dt.astimezone(CHICAGO_TZ).weekday()]


def default_weekly_due_day() -> str:
    """Default due day based on current Chicago local day."""
    return WEEKDAY_NAMES[chicago_now().weekday()]


def is_charge_window(now_local: datetime, target_hour: int = 17) -> bool:
    """
    Return True if current local datetime is inside the billing charge window.
    Window is a full local hour (e.g., 17:00-17:59).
    """
    return now_local.hour == target_hour
