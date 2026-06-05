"""Shared request/response helpers."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from flask import Response, abort, current_app, jsonify, request


def utcnow() -> datetime:
    """Return a naive UTC ``datetime``.

    Centralised so we can switch to timezone-aware everywhere in one
    place. ``utcnow()`` is deprecated in Python 3.12+; this
    helper returns the equivalent naive-UTC value.
    """
    return datetime.now(UTC).replace(tzinfo=None)


def to_date(value: Any) -> date | None:
    """Coerce a string/datetime/date into a ``date``."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def to_datetime(value: Any) -> datetime | None:
    """Coerce a string/datetime into a naive ``datetime``."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value)[:19])


def get_json_data() -> dict:
    """Return the request JSON body or abort with a 400."""
    data = request.get_json(silent=True)
    if data is None:
        abort(
            400, description="Request must contain valid JSON with Content-Type: application/json"
        )
    if not isinstance(data, dict):
        abort(400, description="Request body must be a JSON object")
    return data


def apply_update(model, payload: dict, allowed: set[str]) -> None:
    """Set attributes on ``model`` from ``payload`` for keys in ``allowed``.

    Helper that removes the boilerplate repeated in every PUT handler.
    """
    for key, value in payload.items():
        if key in allowed and hasattr(model, key):
            setattr(model, key, value)


def format_currency(amount: float | int) -> str:
    """Format a number as Vietnamese Dong for use in JSON responses."""
    return f"{amount:,.0f} ₫"


def parse_int(value: Any, default: int | None = None) -> int | None:
    """Parse a query-string integer, falling back to ``default``."""
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_bool(value: Any) -> bool | None:
    """Parse a query-string bool ('true'/'false'/etc.)."""
    if value is None:
        return None
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def try_commit(db_session) -> tuple[Response | None, int | None]:
    """Commit ``db_session`` and return ``(None, None)`` on success.

    On failure, roll back, log the exception (so the server-side trace is
    captured), and return ``(error_response, status_code)`` for the route
    to ``return`` directly. This kills the bare ``except Exception: return
    jsonify({"error": str(exc)}), 400`` pattern that was leaking SQL
    internals to clients.
    """
    try:
        db_session.commit()
    except Exception:
        db_session.rollback()
        current_app.logger.exception("DB commit failed")
        return jsonify({"error": "Database write failed"}), 500
    return None, None

