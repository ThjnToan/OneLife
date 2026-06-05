"""Sleep sessions endpoint."""

from __future__ import annotations

import contextlib
from datetime import datetime

from flask import Blueprint, jsonify, request

from ...models import SleepSession

bp = Blueprint("health_sleep", __name__)


@bp.route("/sleep", methods=["GET"])
def sleep_list():
    limit = min(request.args.get("limit", 30, type=int), 365)
    q = SleepSession.query
    since = request.args.get("since")
    if since:
        with contextlib.suppress(ValueError):
            q = q.filter(SleepSession.start_time >= datetime.fromisoformat(since))
    rows = q.order_by(SleepSession.start_time.desc()).limit(limit).all()
    return jsonify([r.to_dict() for r in rows])
