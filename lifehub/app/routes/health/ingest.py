"""Health Connect Android app ingestion endpoint.

Receives a single batched JSON body from the companion app, dispatches
each section to its typed handler in ``app.services.health_ingest``, and
commits once at the end.

Auth: a SHA-256 of the bearer token in ``INGEST_TOKEN`` is compared in
constant time. The endpoint returns 503 when the token isn't set, so the
companion app can detect that the feature is disabled.
"""

from __future__ import annotations

import hashlib
from functools import wraps
from typing import Any

from flask import Blueprint, current_app, jsonify, request
from marshmallow import ValidationError

from ...extensions import db
from ...schemas import IngestPayloadSchema
from ...services.health_ingest import (
    ingest_calories_out,
    ingest_exercise,
    ingest_heart_rate,
    ingest_hydration,
    ingest_nutrition,
    ingest_sleep,
    ingest_steps,
    ingest_weight,
)
from ...utils import try_commit

bp = Blueprint("health_ingest", __name__)

INGEST_SOURCE = "health_connect"

# section key (JSON) -> (handler, response-counter key).
# heart_rate additionally yields warnings; exercise returns just a count.
# All handlers are normalized to (data, tz_offset) -> result.
_SECTION_HANDLERS: dict[str, tuple[Any, str]] = {
    "steps": (ingest_steps, "steps_days"),
    "heart_rate": (lambda data, _tz: ingest_heart_rate(data), "heart_rate"),
    "sleep": (ingest_sleep, "sleep_sessions"),
    "weight": (ingest_weight, "weight_days"),
    "hydration": (ingest_hydration, "hydration_days"),
    "exercise": (ingest_exercise, "exercise_sessions"),
    "calories_out": (ingest_calories_out, "calories_out_days"),
    "nutrition": (ingest_nutrition, "calories_in_days"),
}


# --------------------------- auth ---------------------------


def _ct_eq_digest(a: str, b: str) -> bool:
    """Constant-time string equality for two hex digests."""
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b, strict=False):
        result |= ord(x) ^ ord(y)
    return result == 0


def _require_ingest_token(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        expected = current_app.config.get("INGEST_TOKEN_SHA256")
        if not expected:
            return (
                jsonify(
                    {
                        "error": (
                            "Ingest endpoint disabled. Set INGEST_TOKEN env var to enable."
                        )
                    }
                ),
                503,
            )
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        presented = auth[7:].strip()
        if not presented:
            return jsonify({"error": "Empty bearer token"}), 401
        digest = hashlib.sha256(presented.encode()).hexdigest()
        if not _ct_eq_digest(digest, expected):
            return jsonify({"error": "Invalid token"}), 401
        return view(*args, **kwargs)

    return wrapped


# --------------------------- helpers ---------------------------


def _load_payload() -> tuple[dict | None, tuple | None]:
    """Return (validated, None) on success or (None, error_response) on failure."""
    max_bytes = current_app.config.get("MAX_INGEST_BYTES", 5 * 1024 * 1024)
    if request.content_length and request.content_length > max_bytes:
        return None, (
            jsonify(
                {
                    "error": (
                        f"Request too large. Limit is {max_bytes} bytes; "
                        f"got {request.content_length}."
                    )
                }
            ),
            413,
        )
    try:
        body = request.get_json(force=True, silent=False) or {}
    except Exception:
        return None, (jsonify({"error": "Invalid JSON body"}), 400)
    if not isinstance(body, dict):
        return None, (jsonify({"error": "Body must be a JSON object"}), 400)
    try:
        return IngestPayloadSchema().load(body), None
    except ValidationError as err:
        return None, (jsonify({"error": "Invalid payload", "fields": err.messages}), 400)


# --------------------------- route ---------------------------


@bp.route("/ingest", methods=["POST"])
@_require_ingest_token
def ingest():
    payload, error = _load_payload()
    if error is not None:
        return error
    assert payload is not None  # for type checkers

    tz_offset = int(payload.get("tz_offset_minutes") or 0)

    written: dict[str, int] = {}
    skipped: dict[str, int] = {}
    warnings: list[str] = []

    def _record(key: str, w: int, s: int) -> None:
        if w or s:
            written[key] = written.get(key, 0) + w
            skipped[key] = skipped.get(key, 0) + s

    for section, (handler, counter) in _SECTION_HANDLERS.items():
        data = payload.get(section)
        if not data:
            continue
        try:
            result = handler(data, tz_offset)
        except Exception:
            current_app.logger.exception("ingest section %s failed", section)
            return jsonify({"error": f"Section {section!r} processing failed"}), 400
        if section == "heart_rate":
            w, s, warns = result
            warnings.extend(warns)
        elif section == "exercise":
            w = result
            s = 0
        else:
            w, s = result
        _record(counter, w, s)

    err, code = try_commit(db.session)
    if err is not None:
        current_app.logger.exception("ingest commit failed")
        return err, code

    return jsonify(
        {
            "status": "ok",
            "tz_offset_minutes": tz_offset,
            "written": written,
            "skipped": skipped,
            "warnings": warnings,
        }
    )
