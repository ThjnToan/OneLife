"""Shared helpers for ingesting health data (Health Connect + Samsung CSV).

This module centralises the timestamp coercion, the per-day HealthEntry
upsert, and the (timestamp, bpm) / (start, end) dedup that was previously
duplicated between ``app/routes/health/ingest.py`` and
``app/routes/health/import_samsung.py``.

The functions here are pure-data and session-aware; the caller manages
the transaction.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from ..extensions import db
from ..models import HealthEntry, HeartRateSample, SleepSession

# --------------------------- Coercion helpers ---------------------------


def to_naive_utc(dt: datetime) -> datetime:
    """Convert any datetime to a naive UTC datetime."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(UTC).replace(tzinfo=None)


def local_iso_date(iso: str, tz_offset_minutes: int) -> str:
    """Return the local YYYY-MM-DD for an ISO-8601 timestamp."""
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    local = dt + timedelta(minutes=tz_offset_minutes)
    return local.date().isoformat()


# --------------------------- HealthEntry upsert ---------------------------


def upsert_health_entry(day_iso: str) -> HealthEntry:
    """Return the (possibly newly-created) HealthEntry for ``day_iso``."""
    from datetime import date

    target = date.fromisoformat(day_iso)
    entry: HealthEntry | None = HealthEntry.query.filter(
        HealthEntry.date == target
    ).first()
    if entry is None:
        entry = HealthEntry(date=target)
        db.session.add(entry)
    return entry


def fill_health_entry_gaps(entry: HealthEntry, payload: dict) -> bool:
    """Fill any None/zero values on ``entry`` from ``payload``.

    Returns True if anything changed. Never overwrites a non-null value
    with None. ``0`` is treated as "missing" for numeric fields (matches
    the long-standing behaviour of the Samsung importer).
    """
    changed = False
    for k, v in payload.items():
        if v is None:
            continue
        current = getattr(entry, k, None)
        if current in (None, 0):
            setattr(entry, k, v)
            changed = True
    return changed


# --------------------------- Dedup helpers ---------------------------


def existing_hr_keys(source: str) -> set[tuple[str, int]]:
    """Load the (iso_ts, bpm) tuples already stored for ``source``."""
    return {
        (to_naive_utc(s.timestamp).isoformat(), s.bpm)
        for s in HeartRateSample.query.filter(HeartRateSample.source == source).all()
    }


def existing_sleep_keys(source: str) -> set[tuple[str, str]]:
    """Load the (start_iso, end_iso) tuples already stored for ``source``."""
    return {
        (
            to_naive_utc(s.start_time).isoformat(),
            to_naive_utc(s.end_time).isoformat(),
        )
        for s in SleepSession.query.filter(SleepSession.source == source).all()
    }


def make_heart_rate_sample(
    ts: datetime, bpm: int, source: str
) -> HeartRateSample:
    return HeartRateSample(timestamp=to_naive_utc(ts), bpm=bpm, source=source)


def make_sleep_session(
    start: datetime,
    end: datetime,
    source: str,
    stages: list[dict] | None = None,
) -> SleepSession:
    import json

    duration = max(0, int((to_naive_utc(end) - to_naive_utc(start)).total_seconds() // 60))
    return SleepSession(
        start_time=to_naive_utc(start),
        end_time=to_naive_utc(end),
        duration_minutes=duration,
        stages_json=json.dumps(stages) if stages else None,
        source=source,
    )


# --------------------------- Generic ingest primitives ---------------------------


def dedup_by(
    rows: Iterable[dict],
    key_fn,
    validate_fn,
) -> tuple[list[dict], list[dict]]:
    """Split ``rows`` into (accepted, rejected) using ``validate_fn``.

    ``validate_fn(row)`` returns either a truthy key (keep), False
    (skip silently), or raises a ValueError (rejected with reason).
    ``key_fn(row)`` is used for downstream dedup; if it returns None the
    row is rejected.
    """
    accepted: list[dict] = []
    rejected: list[dict] = []
    for r in rows:
        try:
            if not validate_fn(r):
                continue
        except (KeyError, TypeError, ValueError):
            rejected.append(r)
            continue
        if key_fn(r) is None:
            rejected.append(r)
            continue
        accepted.append(r)
    return accepted, rejected


def safe_int(value: Any, default: int = 0) -> int | None:
    if value is None:
        return default
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def safe_float(value: Any, default: float = 0.0) -> float | None:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
