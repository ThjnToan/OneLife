"""Lightweight health check endpoint for Docker healthchecks."""

from __future__ import annotations

from flask import Blueprint, jsonify

bp = Blueprint("health_check", __name__)


@bp.route("/api/healthz", methods=["GET"])
def health():
    return jsonify({"status": "ok"})
