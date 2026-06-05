"""Health routes package."""

from __future__ import annotations

from flask import Blueprint

from .crud import bp as crud_bp
from .heart_rate import bp as heart_rate_bp
from .import_samsung import bp as import_samsung_bp
from .ingest import bp as ingest_bp
from .sleep import bp as sleep_bp
from .stats import bp as stats_bp

bp = Blueprint("health", __name__, url_prefix="/api/health")

bp.register_blueprint(crud_bp)
bp.register_blueprint(ingest_bp)
bp.register_blueprint(import_samsung_bp)
bp.register_blueprint(stats_bp)
bp.register_blueprint(heart_rate_bp)
bp.register_blueprint(sleep_bp)
