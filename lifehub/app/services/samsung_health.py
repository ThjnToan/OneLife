"""Parse Samsung Health CSV exports.

Samsung Health's "Download personal data" feature produces a zip
containing CSV files. Filenames look like::

    com.samsung.health.step_count.csv
    com.samsung.health.heart_rate.csv
    com.samsung.shealth.sleep_stage.csv
    com.samsung.health.weight.csv
    com.samsung.health.water_intake.csv
    com.samsung.health.exercise.csv
    com.samsung.health.calories_burned.active.csv
    com.samsung.health.calories_burned.resting.csv
    com.samsung.health.food_intake.csv

Every CSV starts with a metadata header line (``#``, ``start_time``,
binary flag, etc.) followed by a real CSV header and rows. Timestamps
are milliseconds since epoch (UTC).

We aggregate per local date so the user sees their own day boundaries.
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import BinaryIO

SOURCE_TAG = "samsung_csv"


# ----------------------- Value types -----------------------


@dataclass
class DayAggregate:
    """A per-day rollup. Fields are set from whichever Samsung CSVs
    provide data; missing fields stay None so we don't overwrite
    user-entered values."""

    date: str  # ISO format YYYY-MM-DD in the user's local timezone
    steps: int | None = None
    water_liters: float | None = None
    weight: float | None = None
    calories_in: int | None = None
    calories_out: int | None = None
    step_calorie: int | None = None
    distance_km: float | None = None
    workout_minutes: int | None = None
    sleep_minutes: int | None = None
    sleep_sessions: list[dict] = field(default_factory=list)
    heart_rate_samples: list[dict] = field(default_factory=list)
    exercises: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class ParsedExport:
    """The full result of parsing a Samsung Health export."""

    days: dict[str, DayAggregate]
    raw_files: list[str]
    skipped_files: list[str]
    total_steps: int = 0
    total_heart_rate_samples: int = 0
    total_sleep_sessions: int = 0
    date_range: tuple[str | None, str | None] = (None, None)

    def to_summary(self) -> dict:
        days = list(self.days.values())
        return {
            "files_seen": len(self.raw_files),
            "files_skipped": len(self.skipped_files),
            "files_skipped_names": self.skipped_files,
            "date_range": {
                "start": self.date_range[0],
                "end": self.date_range[1],
            },
            "days_with_data": len(days),
            "total_steps": self.total_steps,
            "total_heart_rate_samples": self.total_heart_rate_samples,
            "total_sleep_sessions": self.total_sleep_sessions,
            "per_day": [self._day_summary(d) for d in sorted(days, key=lambda x: x.date)],
        }

    @staticmethod
    def _day_summary(d: DayAggregate) -> dict:
        hr_bpms = [s["bpm"] for s in d.heart_rate_samples if s.get("bpm") is not None]
        hr_min = min(hr_bpms) if hr_bpms else None
        hr_max = max(hr_bpms) if hr_bpms else None
        hr_avg = round(sum(hr_bpms) / len(hr_bpms)) if hr_bpms else None
        exercises_detail = []
        for ex in d.exercises:
            try:
                cal = float(ex.get("calories") or 0)
                dist = float(ex.get("distance_m") or 0)
            except (TypeError, ValueError):
                cal = dist = 0.0
            exercises_detail.append(
                {
                    "type": ex.get("type") or "exercise",
                    "duration_minutes": ex.get("duration_minutes"),
                    "calories": cal if cal else None,
                    "distance_m": dist if dist else None,
                }
            )
        sleep_detail = []
        for s in d.sleep_sessions:
            start = s.get("start_time")
            end = s.get("end_time")
            dur = None
            if start and end:
                try:
                    from datetime import datetime

                    a = datetime.fromisoformat(start)
                    b = datetime.fromisoformat(end)
                    dur = max(0, int((b - a).total_seconds() // 60))
                except Exception:
                    pass
            sleep_detail.append(
                {
                    "start": start,
                    "end": end,
                    "duration_minutes": dur,
                    "stage": s.get("stage"),
                }
            )
        return {
            "date": d.date,
            "steps": d.steps,
            "distance_km": round(d.distance_km, 2) if d.distance_km else None,
            "step_calorie": d.step_calorie,
            "water_liters": d.water_liters,
            "weight": d.weight,
            "calories_in": d.calories_in,
            "calories_out": d.calories_out,
            "workout_minutes": d.workout_minutes,
            "sleep_minutes": d.sleep_minutes,
            "heart_rate_samples": len(d.heart_rate_samples),
            "heart_rate_min": hr_min,
            "heart_rate_max": hr_max,
            "heart_rate_avg": hr_avg,
            "exercises": len(d.exercises),
            "exercises_detail": exercises_detail,
            "sleep_sessions": len(d.sleep_sessions),
            "sleep_detail": sleep_detail,
            "warnings": d.warnings,
        }


# ----------------------- Helpers -----------------------

_MS_HEADER_RE = re.compile(r"start_time\s*=\s*(\d+)")


def _to_utc_datetime(raw) -> datetime | None:
    """Parse a Samsung timestamp into a UTC datetime.

    Samsung CSVs mix two formats: some use millisecond epoch
    (``1705795200000``), others use ISO strings (``2022-08-22 00:45:45.400``).
    Returns None if unparseable.
    """
    if raw is None or raw == "":
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Try millisecond epoch first (most common)
    if s.isdigit() and len(s) >= 10:
        try:
            return datetime.fromtimestamp(int(s) / 1000, tz=UTC)
        except (ValueError, OSError):
            return None
    # Try ISO format. May include ".fff" fractional seconds and a TZ
    # offset like "UTC+0700" or "+07:00".
    if s.startswith("UTC") or s.startswith("GMT"):
        s = s[3:]
    # Normalize "UTC+0700" -> "+0700"
    for needle in ("UTC", "GMT"):
        if s.startswith(needle + "+") or s.startswith(needle + "-"):
            s = s[len(needle) :]
            break
    # Try several variants.
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f%z",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
    ):
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt.astimezone(UTC)
        except ValueError:
            continue
    return None


def _local_date(raw, tz_offset_minutes: int) -> str | None:
    """Convert any Samsung timestamp to a local YYYY-MM-DD.

    Returns None if the timestamp is unparseable.
    """
    dt_utc = _to_utc_datetime(raw)
    if dt_utc is None:
        return None
    local = dt_utc + timedelta(minutes=tz_offset_minutes)
    return local.date().isoformat()


def _datetime_utc(raw) -> datetime | None:
    return _to_utc_datetime(raw)


def _col(row: dict, *names: str):
    """Look up the first non-empty value among the given column names.

    Samsung Health joined-table exports use prefixed column names like
    ``com.samsung.health.step_count.start_time`` while bare exports
    use ``start_time``. This helper tries each candidate and returns
    the first one that is present and non-empty.
    """
    for n in names:
        v = row.get(n)
        if v is not None and v != "":
            return v
    return None


def _read_csv_text(stream: BinaryIO) -> tuple[list[str], Iterable[dict]]:
    """Read a Samsung Health CSV, skipping metadata header lines.

    Returns (column_names, row_iterator). The iterator yields dicts
    keyed by lowercase column name. Empty file -> ([], []).
    """
    raw = stream.read()
    if isinstance(raw, bytes):
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("latin-1", errors="replace")
    else:
        text = raw

    # Samsung CSVs in some exports start with '#'-prefixed metadata,
    # then a row of `tablename,version,column_count`, then the real
    # CSV header. In other exports they skip the '#' lines and go
    # straight to the metadata row. Skip any non-data header.
    lines = text.splitlines()
    body_lines = [ln for ln in lines if ln.strip()]
    if not body_lines:
        return [], []
    # Drop leading '#'-prefixed metadata.
    while body_lines and body_lines[0].lstrip().startswith("#"):
        body_lines.pop(0)
    if not body_lines:
        return [], []
    # The first remaining line is the Samsung metadata: a single
    # `tablename,version,column_count` triple, OR the real CSV header.
    # Detect by counting commas: a real CSV header has the same number
    # of commas as the data rows, while the metadata triple has at
    # most 2. If first line has 2 or fewer commas and the next line
    # has more, drop the first line.
    first = body_lines[0]
    if len(body_lines) > 1 and first.count(",") <= 2 and body_lines[1].count(",") > 2:
        body_lines = body_lines[1:]
    body = "\n".join(body_lines)
    if not body.strip():
        return [], []
    reader = csv.DictReader(io.StringIO(body))
    cols = [c.strip().lower() for c in (reader.fieldnames or [])]

    def _clean(row):
        out = {}
        for k, v in row.items():
            if k is None:
                continue
            out[k.strip().lower()] = (v or "").strip()
        return out

    rows = (_clean(row) for row in reader)
    return cols, rows


# ----------------------- Per-file parsers -----------------------


def _parse_step_count(
    rows: Iterable[dict], out: dict[str, DayAggregate], tz_offset_minutes: int
) -> int:
    """Parse pedometer minute-bucket rows. Each row is a 1-minute
    window with its own `count`, so per-day totals are the SUM."""
    total = 0
    for r in rows:
        count = _col(r, "count", "com.samsung.health.step_count.count")
        if not count or count == "0":
            continue
        try:
            steps = int(float(count))
        except ValueError:
            continue
        if steps <= 0:
            continue
        ts_raw = _col(r, "start_time", "com.samsung.health.step_count.start_time")
        day = _local_date(ts_raw, tz_offset_minutes)
        if day is None:
            continue
        agg = out.setdefault(day, DayAggregate(date=day))
        agg.steps = (agg.steps or 0) + steps
        total += steps
    return total


def _parse_step_daily_trend(
    rows: Iterable[dict], out: dict[str, DayAggregate], tz_offset_minutes: int
) -> int:
    """Parse step_daily_trend rows. Each day can have 2-4 rows from
    different sources (phone pedometer, watch, Health Connect, plus
    re-aggregated "merged" copies). Summing them would double-count.

    Strategy: for each day, pick the row with the HIGHEST `count`,
    which corresponds to the most-active measurement that day. For
    2 identical rows (common: a fresh aggregate and a stale duplicate
    from a later re-sync) this picks one of them. For 4 different
    rows this picks the "primary" view.

    If pedometer data already populated ``agg.steps`` for this day
    (recent Galaxy Watch data is more accurate than phone trend
    aggregates), we keep pedometer's count but still overwrite
    distance/calorie from the trend row — those fields only exist
    here."""
    total = 0
    for r in rows:
        count = _col(r, "count", "com.samsung.shealth.step_daily_trend.count")
        if not count or count == "0":
            continue
        try:
            steps = int(float(count))
        except ValueError:
            continue
        if steps <= 0:
            continue
        ts_raw = _col(r, "day_time", "com.samsung.shealth.step_daily_trend.day_time")
        day = _local_date(ts_raw, tz_offset_minutes)
        if day is None:
            continue
        agg = out.setdefault(day, DayAggregate(date=day))
        existing_steps = agg.steps
        is_new_max = existing_steps is None or steps > existing_steps
        if is_new_max:
            agg.steps = steps
            # Re-derive distance/calorie from THIS winning row.
            # Sub-aggregation rows that have a lower count must not
            # overwrite these — they describe a different measurement.
            dist = _col(r, "distance", "com.samsung.shealth.step_daily_trend.distance")
            if dist:
                try:
                    meters = float(dist)
                except ValueError:
                    meters = 0
                agg.distance_km = (meters / 1000.0) if meters > 0 else None
            cal = _col(r, "calorie", "com.samsung.shealth.step_daily_trend.calorie")
            if cal:
                try:
                    c = int(round(float(cal)))
                except ValueError:
                    c = 0
                agg.step_calorie = c if c > 0 else None
        elif existing_steps is None:
            # First row for this day and it has no distance/calorie.
            agg.steps = steps
        # If this row is NOT a new max, leave distance/calorie alone
        # — they belong to the winning row, not to sub-aggregations.
        total += steps
    return total


def _parse_heart_rate(
    rows: Iterable[dict], out: dict[str, DayAggregate], tz_offset_minutes: int
) -> int:
    total = 0
    for r in rows:
        bpm_s = _col(
            r,
            "heart_rate",
            "bpm",
            "value",
            "com.samsung.health.heart_rate.heart_rate",
            "com.samsung.health.heart_rate.bpm",
            "com.samsung.health.heart_rate.value",
        )
        if not bpm_s:
            continue
        try:
            bpm = int(round(float(bpm_s)))
        except ValueError:
            continue
        if bpm < 20 or bpm > 250:  # obvious garbage
            continue
        ts_raw = _col(
            r,
            "start_time",
            "time",
            "day_time",
            "com.samsung.health.heart_rate.start_time",
            "com.samsung.health.heart_rate.day_time",
        )
        if not ts_raw:
            continue
        day = _local_date(ts_raw, tz_offset_minutes)
        if day is None:
            continue
        ts = _datetime_utc(ts_raw)
        if ts is None:
            continue
        agg = out.setdefault(day, DayAggregate(date=day))
        agg.heart_rate_samples.append({"timestamp": ts.isoformat(), "bpm": bpm})
        total += 1
    return total


def _parse_weight(
    rows: Iterable[dict], out: dict[str, DayAggregate], tz_offset_minutes: int
) -> int:
    count = 0
    for r in rows:
        w = _col(r, "weight", "com.samsung.health.weight.weight")
        if not w:
            continue
        try:
            kg = float(w)
        except ValueError:
            continue
        if kg < 20 or kg > 400:
            continue
        ts_raw = _col(
            r,
            "start_time",
            "day_time",
            "com.samsung.health.weight.start_time",
            "com.samsung.health.weight.day_time",
        )
        if not ts_raw:
            continue
        day = _local_date(ts_raw, tz_offset_minutes)
        if day is None:
            continue
        agg = out.setdefault(day, DayAggregate(date=day))
        # Take the last (most recent) weight of the day
        agg.weight = kg
        count += 1
    return count


def _parse_water(rows: Iterable[dict], out: dict[str, DayAggregate], tz_offset_minutes: int) -> int:
    count = 0
    for r in rows:
        amt = _col(r, "amount", "com.samsung.health.water_intake.amount")
        if not amt:
            continue
        try:
            liters = float(amt)
        except ValueError:
            continue
        ts_raw = _col(
            r,
            "start_time",
            "day_time",
            "com.samsung.health.water_intake.start_time",
            "com.samsung.health.water_intake.day_time",
        )
        if not ts_raw:
            continue
        day = _local_date(ts_raw, tz_offset_minutes)
        if day is None:
            continue
        agg = out.setdefault(day, DayAggregate(date=day))
        agg.water_liters = (agg.water_liters or 0) + liters
        count += 1
    return count


def _parse_exercise(
    rows: Iterable[dict], out: dict[str, DayAggregate], tz_offset_minutes: int
) -> tuple[int, int]:
    """Returns (session_count, total_minutes)."""
    count = 0
    total_minutes = 0
    for r in rows:
        start_dt = _datetime_utc(
            _col(
                r,
                "start_time",
                "com.samsung.health.exercise.start_time",
                "com.samsung.shealth.exercise.start_time",
            )
        )
        end_dt = _datetime_utc(
            _col(
                r,
                "end_time",
                "com.samsung.health.exercise.end_time",
                "com.samsung.shealth.exercise.end_time",
            )
        )
        if start_dt is None or end_dt is None:
            continue
        duration_min = max(0, int((end_dt - start_dt).total_seconds() // 60))
        if duration_min <= 0:
            continue
        try:
            calorie = float(
                _col(
                    r,
                    "calorie",
                    "com.samsung.health.exercise.calorie",
                    "com.samsung.shealth.exercise.calorie",
                )
                or 0
            )
            distance = float(
                _col(
                    r,
                    "distance",
                    "com.samsung.health.exercise.distance",
                    "com.samsung.shealth.exercise.distance",
                )
                or 0
            )
        except ValueError:
            calorie, distance = 0.0, 0.0
        ts_raw = _col(
            r,
            "start_time",
            "com.samsung.health.exercise.start_time",
            "com.samsung.shealth.exercise.start_time",
        )
        day = _local_date(ts_raw, tz_offset_minutes)
        if day is None:
            continue
        agg = out.setdefault(day, DayAggregate(date=day))
        agg.exercises.append(
            {
                "type": (
                    r.get("exercise_type_name")
                    or r.get("exercise_type")
                    or r.get("type")
                    or "unknown"
                ),
                "type_id": r.get("exercise_type") or None,
                "start_time": start_dt.isoformat(),
                "end_time": end_dt.isoformat(),
                "duration_minutes": duration_min,
                "calories": calorie,
                "distance_m": distance,
            }
        )
        agg.workout_minutes = (agg.workout_minutes or 0) + duration_min
        total_minutes += duration_min
        count += 1
    return count, total_minutes


def _parse_calories(
    rows: Iterable[dict],
    out: dict[str, DayAggregate],
    tz_offset_minutes: int,
    field: str = "calorie",
) -> int:
    """Used for both active and resting calories-burned (and food_intake)."""
    # calories_burned.details uses prefixed field names
    prefixed = f"com.samsung.shealth.calories_burned.{field}"
    prefixed_active = "com.samsung.shealth.calories_burned.active_calorie"
    prefixed_cal = "com.samsung.shealth.calories_burned.calorie"
    count = 0
    for r in rows:
        v = _col(r, field, prefixed, prefixed_active, prefixed_cal)
        if not v:
            continue
        try:
            amount = float(v)
        except ValueError:
            continue
        ts_raw = _col(
            r,
            "start_time",
            "day_time",
            "com.samsung.shealth.calories_burned.start_time",
            "com.samsung.shealth.calories_burned.day_time",
        )
        if not ts_raw:
            continue
        day = _local_date(ts_raw, tz_offset_minutes)
        if day is None:
            continue
        agg = out.setdefault(day, DayAggregate(date=day))
        agg.calories_out = (agg.calories_out or 0) + amount
        count += 1
    return count


def _parse_food_intake(
    rows: Iterable[dict], out: dict[str, DayAggregate], tz_offset_minutes: int
) -> int:
    count = 0
    for r in rows:
        v = _col(
            r,
            "calorie",
            "calories",
            "com.samsung.health.food_intake.calorie",
            "com.samsung.health.food_intake.calories",
        )
        if not v:
            continue
        try:
            amount = float(v)
        except ValueError:
            continue
        ts_raw = _col(
            r,
            "start_time",
            "day_time",
            "time",
            "com.samsung.health.food_intake.start_time",
            "com.samsung.health.food_intake.day_time",
        )
        if not ts_raw:
            continue
        day = _local_date(ts_raw, tz_offset_minutes)
        if day is None:
            continue
        agg = out.setdefault(day, DayAggregate(date=day))
        agg.calories_in = (agg.calories_in or 0) + amount
        count += 1
    return count


def _parse_sleep(rows: Iterable[dict], out: dict[str, DayAggregate], tz_offset_minutes: int) -> int:
    """Samsung Health sleep CSVs have either:
      - One row per stage with stage/start_time/end_time columns, or
      - One row per session with start_time/end_time only.

    We support both. The "day" a sleep session belongs to is its
    *end* date (when you woke up) so 23:00→07:00 shows on the wake day.
    """
    count = 0
    for r in rows:
        start_dt = _datetime_utc(
            _col(
                r,
                "start_time",
                "com.samsung.health.sleep.start_time",
                "com.samsung.shealth.sleep.start_time",
            )
        )
        end_dt = _datetime_utc(
            _col(
                r,
                "end_time",
                "com.samsung.health.sleep.end_time",
                "com.samsung.shealth.sleep.end_time",
            )
        )
        if start_dt is None or end_dt is None:
            continue
        duration_min = max(0, int((end_dt - start_dt).total_seconds() // 60))
        if duration_min <= 0:
            continue
        end_raw = _col(
            r, "end_time", "com.samsung.health.sleep.end_time", "com.samsung.shealth.sleep.end_time"
        )
        wake_day = _local_date(end_raw, tz_offset_minutes)
        if wake_day is None:
            continue
        agg = out.setdefault(wake_day, DayAggregate(date=wake_day))
        stage = r.get("stage") or r.get("sleep_stage") or "asleep"
        agg.sleep_sessions.append(
            {
                "start_time": start_dt.isoformat(),
                "end_time": end_dt.isoformat(),
                "stage": stage,
            }
        )
        agg.sleep_minutes = (agg.sleep_minutes or 0) + duration_min
        count += 1
    return count


# ----------------------- Dispatcher -----------------------

_FILE_PARSERS = {
    "step_count": _parse_step_count,
    "step_daily_trend": _parse_step_daily_trend,
    "heart_rate": _parse_heart_rate,
    "weight": _parse_weight,
    "water_intake": _parse_water,
    "exercise": _parse_exercise,
    "food_intake": _parse_food_intake,
    "sleep_stage": _parse_sleep,
    "sleep": _parse_sleep,
}


def _classify_csv(name: str) -> tuple[str, str] | None:
    """Map a filename to (kind, field). Kind drives the parser; field
    is the column to read for calorie-style files.

    Samsung filenames take the shape ``com.samsung.<pkg>.<table>`` and
    newer exports also have ``com.samsung.shealth.tracker.<table>``.
    We use an explicit allow/deny match to avoid substring traps like
    ``sleep_apnea`` matching ``sleep``.
    """
    n = name.lower().rsplit("/", 1)[-1].removesuffix(".csv")
    # Real Samsung exports append a date stamp (e.g. ``.20260604153209``)
    # to every filename. Strip that 14-digit suffix when present.
    if "." in n and n.rsplit(".", 1)[-1].isdigit() and len(n.rsplit(".", 1)[-1]) == 14:
        n = n.rsplit(".", 1)[0]

    # 1. Explicit denylist — files that look like data but aren't
    #    parseable. Match against the full normalised name.
    deny_substrings = (
        "_goal",
        "goal.",
        ".goal",
        "custom_exercise",
        ".extension",
        "periodization",
        "program.sleep_coaching",
        "sleep_raw_data",
        "sleep_snoring",
        "sleep_combined",
        "sleep_apnea",
        "alerted_heart_rate",
        "alerted_stress",
        "exercise.weather",
        "exercise.hr_zone",
        "exercise.recovery_heart_rate",
        "exercise.max_heart_rate",
        "calibration_",
    )
    for d in deny_substrings:
        if d in n:
            return None

    # 2. The "table key" is the trailing dot-segment(s) after the
    #    package (``com.samsung.<pkg>.<table>`` → ``<table>``,
    #    ``com.samsung.shealth.tracker.<table>`` → ``tracker.<table>``).
    parts = n.split(".")
    if len(parts) < 4:
        return None
    table_key = ".".join(parts[3:])  # drop "com.samsung.<pkg>"

    # 3. Tables we have parsers for.
    step_tables = {
        "step_count",
        "tracker.pedometer_step_count",
        "step_daily_trend",
        "tracker.step_daily_trend",
    }
    hr_tables = {
        "heart_rate",
        "tracker.heart_rate",
    }
    single_tables = {
        "weight": "weight",
        "water_intake": "water_intake",
        "food_intake": "food_intake",
        "sleep": "sleep",
        "sleep_stage": "sleep",
        "exercise": "exercise",
        "calories_burned": "calories",
        "calories_burned.active": "calories",
        "calories_burned.details": "calories",
        "tracker.calories_burned": "calories",
    }

    if table_key in step_tables:
        # step_daily_trend has multiple rows per day from different
        # sources, so it needs its own parser with MAX-per-day
        # semantics. The pedometer minute-bucket file uses SUM.
        if table_key in ("step_daily_trend", "tracker.step_daily_trend"):
            return ("step_daily_trend", "")
        return ("step_count", "")
    if table_key in hr_tables:
        return ("heart_rate", "")
    kind = single_tables.get(table_key)
    if kind is not None:
        return (kind, "calorie" if kind == "calories" else "")
    return None


# ----------------------- Public API -----------------------


def parse_zip(zip_bytes: bytes, tz_offset_minutes: int = 0) -> ParsedExport:
    """Parse a Samsung Health export ZIP. Returns a ``ParsedExport``.

    ``tz_offset_minutes`` is the user's offset from UTC in minutes
    (e.g. +420 for ICT/Vietnam, -300 for EST). Defaults to 0 (UTC).
    """
    days: dict[str, DayAggregate] = {}
    seen: list[str] = []
    skipped: list[str] = []
    total_steps = 0
    total_hr = 0
    total_sleep = 0

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for info in zf.infolist():
            name = info.filename
            if info.is_dir() or not name.lower().endswith(".csv"):
                continue
            seen.append(name)
            classification = _classify_csv(name)
            if not classification:
                skipped.append(name)
                continue
            kind, field = classification
            with zf.open(info) as f:
                try:
                    _, rows = _read_csv_text(f)
                except Exception:
                    skipped.append(name)
                    continue
            if kind == "step_count":
                # Parse the pedometer minute-bucket file first so its
                # per-day totals land in agg.steps before the trend
                # file is consulted. The trend parser will keep the
                # higher of (pedometer, trend's MAX-per-day) and use
                # trend's row for distance/calorie.
                if "step_daily_trend" not in name:
                    total_steps += _parse_step_count(rows, days, tz_offset_minutes)
            elif kind == "step_daily_trend":
                total_steps += _parse_step_daily_trend(rows, days, tz_offset_minutes)
            elif kind == "heart_rate":
                total_hr += _parse_heart_rate(rows, days, tz_offset_minutes)
            elif kind == "weight":
                _parse_weight(rows, days, tz_offset_minutes)
            elif kind == "water_intake":
                _parse_water(rows, days, tz_offset_minutes)
            elif kind == "exercise":
                _parse_exercise(rows, days, tz_offset_minutes)
            elif kind == "food_intake":
                _parse_food_intake(rows, days, tz_offset_minutes)
            elif kind == "sleep":
                total_sleep += _parse_sleep(rows, days, tz_offset_minutes)
            elif kind == "calories":
                _parse_calories(rows, days, tz_offset_minutes, field=field)

    # Date range
    if days:
        keys = sorted(days.keys())
        date_range = (keys[0], keys[-1])
    else:
        date_range = (None, None)

    return ParsedExport(
        days=days,
        raw_files=seen,
        skipped_files=skipped,
        total_steps=total_steps,
        total_heart_rate_samples=total_hr,
        total_sleep_sessions=total_sleep,
        date_range=date_range,
    )


def merge_into_health_entries(parsed: ParsedExport) -> list[dict]:
    """Return per-day payloads ready to upsert into HealthEntry."""
    out = []
    for day_iso in sorted(parsed.days):
        d = parsed.days[day_iso]
        payload: dict = {"date": d.date}
        if d.steps is not None:
            payload["steps"] = d.steps
        if d.water_liters is not None:
            payload["water_liters"] = round(d.water_liters, 2)
        if d.weight is not None:
            payload["weight"] = d.weight
        if d.calories_in is not None:
            payload["calories_in"] = int(round(d.calories_in))
        if d.calories_out is not None:
            payload["calories_out"] = int(round(d.calories_out))
        if d.step_calorie is not None:
            payload["step_calorie"] = d.step_calorie
        if d.distance_km is not None:
            payload["distance_km"] = round(d.distance_km, 2)
        if d.workout_minutes is not None:
            payload["workout_minutes"] = d.workout_minutes
        if d.sleep_minutes is not None:
            payload["sleep_hours"] = round(d.sleep_minutes / 60, 2)
        if d.exercises:
            payload["notes"] = json.dumps({"samsung_exercises": d.exercises}, ensure_ascii=False)
        out.append(payload)
    return out
