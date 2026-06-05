"""User settings API.

``GET /api/settings``           - all settings grouped, with current values
``PUT /api/settings``           - bulk update, body ``{"key": value, ...}``
``POST /api/settings/reset``    - delete all stored values (revert to defaults)
``GET /api/server-info``        - read-only server env (URL, token status)
"""

from __future__ import annotations

from flask import Blueprint, jsonify

from ..services import settings as svc
from ..utils import get_json_data

bp = Blueprint("settings", __name__, url_prefix="/api")


@bp.route("/settings", methods=["GET"])
def get_settings():
    return jsonify(svc.all_settings())


@bp.route("/settings", methods=["PUT"])
def update_settings():
    payload = get_json_data() or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "Body must be a JSON object"}), 400
    applied, errors = svc.set_many(payload)
    if errors:
        return jsonify({"error": "Validation failed", "details": errors}), 400
    return jsonify({"applied": applied, **svc.all_settings()})


@bp.route("/settings/reset", methods=["POST"])
def reset_settings():
    n = svc.reset_all()
    return jsonify({"deleted": n, **svc.all_settings()})


@bp.route("/server-info", methods=["GET"])
def server_info():
    return jsonify(svc.server_info())
