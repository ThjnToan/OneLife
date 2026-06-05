"""Per-type ingest logic for /api/health/ingest.

Each function takes the raw list from the ingest payload, the user's
``tz_offset_minutes``, and returns ``(written_count, skipped_count)``.
Side effects (db.session.add) are deferred to the caller, which commits
once at the end of the request.
"""

from __future__ import annotations

from datetime import datetime

from ..extensions import db
from ..models import SleepSession
from .health_merge import (
    existing_hr_keys,
    existing_sleep_keys,
    local_iso_date,
    make_heart_rate_sample,
    to_naive_utc,
    upsert_health_entry,
)

# --------------------------- steps ---------------------------


def ingest_steps(steps: list[dict], tz_offset: int) -> tuple[int, int]:
    """Sum steps per local day, take the max seen so far."""
    daily: dict[str, int] = {}
    for s in steps:
        try:
            start = s["start"]
            count = int(s.get("count") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if count <= 0:
            continue
        day = local_iso_date(start, tz_offset)
        daily[day] = daily.get(day, 0) + count
    w = sk = 0
    for day_iso, total in daily.items():
        entry = upsert_health_entry(day_iso)
        if total > (entry.steps or 0):
            entry.steps = total
            w += 1
        else:
            sk += 1
    return w, sk


# --------------------------- heart rate ---------------------------


def ingest_heart_rate(samples: list[dict]) -> tuple[int, int, list[str]]:
    """Dedup by (timestamp, bpm); reject out-of-range bpm."""
    warnings: list[str] = []
    existing = existing_hr_keys("health_connect")
    w = sk = 0
    for s in samples:
        try:
            ts_iso = s["timestamp"]
            bpm = int(round(float(s["bpm"])))
        except (KeyError, TypeError, ValueError):
            warnings.append("heart_rate: missing fields")
            continue
        if bpm < 20 or bpm > 250:
            continue
        try:
            ts = to_naive_utc(datetime.fromisoformat(ts_iso.replace("Z", "+00:00")))
        except ValueError:
            continue
        key = (ts.isoformat(), bpm)
        if key in existing:
            sk += 1
            continue
        db.session.add(make_heart_rate_sample(ts, bpm, "health_connect"))
        existing.add(key)
        w += 1
    return w, sk, warnings


# --------------------------- sleep ---------------------------


def ingest_sleep(
    sessions: list[dict], tz_offset: int
) -> tuple[int, int]:
    """Dedup by (start, end); fold duration into HealthEntry.sleep_hours."""
    import json

    existing = existing_sleep_keys("health_connect")
    w = sk = 0
    for s in sessions:
        try:
            start_iso = s["start"]
            end_iso = s["end"]
        except KeyError:
            continue
        try:
            start_dt = to_naive_utc(datetime.fromisoformat(start_iso.replace("Z", "+00:00")))
            end_dt = to_naive_utc(datetime.fromisoformat(end_iso.replace("Z", "+00:00")))
        except ValueError:
            continue
        key = (start_dt.isoformat(), end_dt.isoformat())
        if key in existing:
            sk += 1
            continue
        stages = s.get("stages")
        db.session.add(
            SleepSession(
                start_time=start_dt,
                end_time=end_dt,
                duration_minutes=max(0, int((end_dt - start_dt).total_seconds() // 60)),
                stages_json=json.dumps(stages) if stages else None,
                source="health_connect",
            )
        )
        wake_day = local_iso_date(end_iso, tz_offset)
        entry = upsert_health_entry(wake_day)
        new_hours = (end_dt - start_dt).total_seconds() / 3600
        if new_hours > (entry.sleep_hours or 0):
            entry.sleep_hours = round(new_hours, 2)
        existing.add(key)
        w += 1
    return w, sk


# --------------------------- weight ---------------------------


def ingest_weight(samples: list[dict], tz_offset: int) -> tuple[int, int]:
    """Take the latest weight per day; only fill empty entries."""
    per_day: dict[str, tuple[datetime, float]] = {}
    for s in samples:
        try:
            ts_iso = s["timestamp"]
            kg = float(s["kg"])
        except (KeyError, TypeError, ValueError):
            continue
        if kg < 20 or kg > 400:
            continue
        try:
            ts = to_naive_utc(datetime.fromisoformat(ts_iso.replace("Z", "+00:00")))
        except ValueError:
            continue
        day = local_iso_date(ts_iso, tz_offset)
        existing = per_day.get(day)
        if existing is None or ts > existing[0]:
            per_day[day] = (ts, kg)
    w = sk = 0
    for day_iso, (_, kg) in per_day.items():
        entry = upsert_health_entry(day_iso)
        if entry.weight is None:
            entry.weight = kg
            w += 1
        else:
            sk += 1
    return w, sk


# --------------------------- hydration ---------------------------


def ingest_hydration(samples: list[dict], tz_offset: int) -> tuple[int, int]:
    """Sum hydration per day; only fill empty entries."""
    daily: dict[str, float] = {}
    for s in samples:
        try:
            ts_iso = s["timestamp"]
            liters = float(s.get("liters") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if liters <= 0:
            continue
        day = local_iso_date(ts_iso, tz_offset)
        daily[day] = daily.get(day, 0) + liters
    w = sk = 0
    for day_iso, total in daily.items():
        entry = upsert_health_entry(day_iso)
        if entry.water_liters is None or total > entry.water_liters:
            entry.water_liters = round(total, 2)
            w += 1
        else:
            sk += 1
    return w, sk


# --------------------------- exercise ---------------------------


def ingest_exercise(sessions: list[dict], tz_offset: int) -> int:
    """Add minutes to HealthEntry.workout_minutes per day (always increments)."""
    w = 0
    for s in sessions:
        try:
            start_iso = s["start"]
            end_iso = s["end"]
        except KeyError:
            continue
        try:
            start_dt = to_naive_utc(datetime.fromisoformat(start_iso.replace("Z", "+00:00")))
            end_dt = to_naive_utc(datetime.fromisoformat(end_iso.replace("Z", "+00:00")))
        except ValueError:
            continue
        duration = max(0, int((end_dt - start_dt).total_seconds() // 60))
        if duration <= 0:
            continue
        day = local_iso_date(start_iso, tz_offset)
        entry = upsert_health_entry(day)
        current = entry.workout_minutes or 0
        new_total = current + duration
        if new_total > current:
            entry.workout_minutes = new_total
        w += 1
    return w


# --------------------------- calories_out ---------------------------


def ingest_calories_out(samples: list[dict], tz_offset: int) -> tuple[int, int]:
    """Sum kcal per day; only fill empty entries."""
    daily: dict[str, float] = {}
    for s in samples:
        try:
            ts_iso = s["start"]
            kcal = float(s.get("kcal") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if kcal <= 0:
            continue
        day = local_iso_date(ts_iso, tz_offset)
        daily[day] = daily.get(day, 0) + kcal
    w = sk = 0
    for day_iso, total in daily.items():
        entry = upsert_health_entry(day_iso)
        if total > (entry.calories_out or 0):
            entry.calories_out = int(round(total))
            w += 1
        else:
            sk += 1
    return w, sk


# --------------------------- nutrition (calories in) ---------------------------


def ingest_nutrition(samples: list[dict], tz_offset: int) -> tuple[int, int]:
    """Sum kcal per day; only fill empty entries."""
    daily: dict[str, float] = {}
    for s in samples:
        try:
            ts_iso = s["start"]
            kcal = float(s.get("kcal") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if kcal <= 0:
            continue
        day = local_iso_date(ts_iso, tz_offset)
        daily[day] = daily.get(day, 0) + kcal
    w = sk = 0
    for day_iso, total in daily.items():
        entry = upsert_health_entry(day_iso)
        if total > (entry.calories_in or 0):
            entry.calories_in = int(round(total))
            w += 1
        else:
            sk += 1
    return w, sk
