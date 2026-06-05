"""Samsung Health CSV import endpoint."""

from __future__ import annotations

from flask import Blueprint, abort, current_app, jsonify, request

from ...extensions import db
from ...models import HealthEntry
from ...services.health_merge import (
    existing_hr_keys,
    existing_sleep_keys,
    fill_health_entry_gaps,
    make_heart_rate_sample,
    make_sleep_session,
    to_naive_utc,
)
from ...services.samsung_health import (
    SOURCE_TAG,
    merge_into_health_entries,
    parse_zip,
)
from ...utils import to_date

bp = Blueprint("health_import_samsung", __name__)


# --------------------------- helpers ---------------------------


def _tz_offset_from_request() -> int:
    raw = request.args.get("tz_offset_minutes")
    if raw is not None:
        try:
            return int(raw)
        except ValueError:
            return 0
    return 0


def _read_zip_payload() -> bytes:
    if "file" in request.files:
        return request.files["file"].read()  # type: ignore[no-any-return]
    if request.data:
        return request.data
    abort(
        400,
        description=(
            "No file uploaded. Use multipart field 'file' or send the zip as the raw body."
        ),
    )


# --------------------------- route ---------------------------


@bp.route("/import-samsung", methods=["POST"])
def import_samsung():
    tz_offset = _tz_offset_from_request()
    confirm_param = request.args.get("confirm", "false").lower() in {
        "1",
        "true",
        "yes",
    }
    confirm_body = False
    if not confirm_param and request.is_json:
        confirm_body = bool((request.get_json(silent=True) or {}).get("confirm", False))
    confirm = confirm_param or confirm_body

    try:
        zip_bytes = _read_zip_payload()
    except Exception as exc:
        return jsonify({"error": f"Could not read upload: {exc}"}), 400

    if not zip_bytes:
        return jsonify({"error": "Empty upload"}), 400

    try:
        parsed = parse_zip(zip_bytes, tz_offset_minutes=tz_offset)
    except Exception as exc:
        return jsonify({"error": f"Could not parse zip: {exc}"}), 400

    summary = parsed.to_summary()

    if not confirm:
        return jsonify(
            {
                "status": "preview",
                "tz_offset_minutes": tz_offset,
                "summary": summary,
                "hint": "Re-send with ?confirm=true to write to the database.",
            }
        )

    written_health = 0
    skipped_health = 0
    written_hr = 0
    skipped_hr = 0
    written_sleep = 0
    skipped_sleep = 0

    # HealthEntry upsert (fill gaps, never overwrite)
    payloads = merge_into_health_entries(parsed)
    for payload in payloads:
        day_iso = payload.pop("date")
        day_date = to_date(day_iso)
        existing = HealthEntry.query.filter(HealthEntry.date == day_date).first()
        if existing is None:
            db.session.add(HealthEntry(date=day_date, **payload))
            written_health += 1
        else:
            changed = fill_health_entry_gaps(existing, payload)
            if changed:
                written_health += 1
            else:
                skipped_health += 1

    # Heart-rate samples (dedup by (ts, bpm))
    hr_rows: list[tuple[str, int]] = []
    for day in parsed.days.values():
        for s in day.heart_rate_samples:  # type: ignore[union-attr]
            ts_raw = s["timestamp"]  # type: ignore[index,union-attr]
            bpm = int(s["bpm"])  # type: ignore[index,union-attr]
            hr_rows.append((ts_raw, bpm))
    if hr_rows:
        existing_hr = existing_hr_keys(SOURCE_TAG)
        for ts_iso, bpm in hr_rows:
            try:
                ts_aware = _import_ts(ts_iso)
            except ValueError:
                skipped_hr += 1
                continue
            ts_naive = to_naive_utc(ts_aware)
            hr_key: tuple[str, int] = (ts_naive.isoformat(), bpm)
            if hr_key in existing_hr:
                skipped_hr += 1
                continue
            db.session.add(make_heart_rate_sample(ts_naive, bpm, SOURCE_TAG))
            existing_hr.add(hr_key)
            written_hr += 1

    # Sleep sessions (dedup by start+end)
    sleep_rows: list[tuple[str, str]] = []
    for day in parsed.days.values():
        for s in day.sleep_sessions:  # type: ignore[union-attr]
            start_iso = s["start_time"]  # type: ignore[index,union-attr]
            end_iso = s["end_time"]  # type: ignore[index,union-attr]
            sleep_rows.append((start_iso, end_iso))
    if sleep_rows:
        existing_sleep = existing_sleep_keys(SOURCE_TAG)
        for start_iso, end_iso in sleep_rows:
            try:
                start_dt = to_naive_utc(_import_ts(start_iso))
                end_dt = to_naive_utc(_import_ts(end_iso))
            except ValueError:
                skipped_sleep += 1
                continue
            key = (start_dt.isoformat(), end_dt.isoformat())
            if key in existing_sleep:
                skipped_sleep += 1
                continue
            db.session.add(make_sleep_session(start_dt, end_dt, SOURCE_TAG))
            existing_sleep.add(key)  # type: ignore[arg-type]
            written_sleep += 1

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("import-samsung commit failed")
        return jsonify({"error": "DB commit failed"}), 500

    return jsonify(
        {
            "status": "imported",
            "tz_offset_minutes": tz_offset,
            "summary": summary,
            "written": {
                "health_entries": written_health,
                "heart_rate_samples": written_hr,
                "sleep_sessions": written_sleep,
            },
            "skipped": {
                "health_entries": skipped_health,
                "heart_rate_samples": skipped_hr,
                "sleep_sessions": skipped_sleep,
            },
        }
    )


def _import_ts(iso: str):
    """Parse a Samsung Health ISO timestamp."""
    from datetime import datetime

    return datetime.fromisoformat(iso)
