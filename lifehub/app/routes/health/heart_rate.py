"""Heart rate samples endpoint."""

from __future__ import annotations

import contextlib
from datetime import datetime

from flask import Blueprint, jsonify, request

from ...models import HeartRateSample

bp = Blueprint("health_heart_rate", __name__)


@bp.route("/heart-rate", methods=["GET"])
def heart_rate_list():
    limit = min(request.args.get("limit", 200, type=int), 5000)
    q = HeartRateSample.query
    since = request.args.get("since")
    if since:
        with contextlib.suppress(ValueError):
            q = q.filter(HeartRateSample.timestamp >= datetime.fromisoformat(since))
    rows = q.order_by(HeartRateSample.timestamp.desc()).limit(limit).all()
    return jsonify([r.to_dict() for r in rows])
