"""OneLife Flask application factory."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from flask import Flask, render_template

from .config import BaseConfig, _compute_ingest_token_sha256, get_config
from .errors import register_error_handlers
from .extensions import cors, db, limiter, migrate


def _seed_default_budget_categories(app: Flask) -> None:
    from .models import BudgetCategory

    with app.app_context():
        if BudgetCategory.query.count() == 0:
            defaults = [BudgetCategory(**cfg) for cfg in app.config["DEFAULT_BUDGET_CATEGORIES"]]
            db.session.add_all(defaults)
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
                app.logger.exception("Failed to seed default budget categories")


def create_app(config_class: type[BaseConfig] | str | None = None) -> Flask:
    project_root = Path(__file__).resolve().parent.parent
    app = Flask(
        __name__,
        instance_path=str(project_root / "instance"),
        instance_relative_config=False,
        template_folder=str(project_root / "templates"),
        static_folder=str(project_root / "static"),
        static_url_path="/static",
    )
    if config_class is None:
        config_class = get_config()
    elif isinstance(config_class, str):
        config_class = get_config(config_class)
    app.config.from_object(config_class)
    # Compute runtime config that depends on the current env state.
    app.config["INGEST_TOKEN_SHA256"] = _compute_ingest_token_sha256()
    # flask-limiter reads these from app.config at init_app time.
    app.config.setdefault("RATELIMIT_DEFAULT", "200 per minute")
    app.config.setdefault("RATELIMIT_STORAGE_URI", app.config.get("RATELIMIT_STORAGE_URL", "memory://"))

    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    migrate.init_app(app, db)
    cors.init_app(app, origins=app.config.get("CORS_ORIGINS", "*"))
    limiter.init_app(app)

    from . import models  # noqa: F401  (register models with SQLAlchemy)
    from .routes import (
        assets as assets_routes,
    )
    from .routes import (
        calendar as calendar_routes,
    )
    from .routes import (
        contacts as contacts_routes,
    )
    from .routes import (
        dashboard as dashboard_routes,
    )
    from .routes import (
        documents as documents_routes,
    )
    from .routes import (
        finance as finance_routes,
    )
    from .routes import (
        folders as folders_routes,
    )
    from .routes import (
        goals as goals_routes,
    )
    from .routes import (
        health as health_routes,
    )
    from .routes import (
        health_check as health_check_routes,
    )
    from .routes import (
        io as io_routes,
    )
    from .routes import (
        journal as journal_routes,
    )
    from .routes import (
        learning as learning_routes,
    )
    from .routes import (
        search as search_routes,
    )
    from .routes import (
        settings as settings_routes,
    )
    from .routes import (
        tasks as tasks_routes,
    )

    app.register_blueprint(tasks_routes.bp)
    app.register_blueprint(health_routes.bp)
    app.register_blueprint(health_check_routes.bp)
    app.register_blueprint(finance_routes.bp)
    app.register_blueprint(assets_routes.bp)
    app.register_blueprint(learning_routes.bp)
    app.register_blueprint(calendar_routes.bp)
    app.register_blueprint(contacts_routes.bp)
    app.register_blueprint(documents_routes.bp)
    app.register_blueprint(folders_routes.bp)
    app.register_blueprint(journal_routes.bp)
    app.register_blueprint(goals_routes.bp)
    app.register_blueprint(dashboard_routes.bp)
    app.register_blueprint(search_routes.bp)
    app.register_blueprint(io_routes.bp)
    app.register_blueprint(settings_routes.bp)

    register_error_handlers(app)

    # Security and caching headers. HSTS is only sent over HTTPS, so we
    # leave it to a reverse proxy in production (e.g. nginx). The
    # remaining headers are safe to set in every environment.
    @app.after_request
    def _security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if request_is_static():
            # Flask's default for static files is "no-cache" to support
            # development. We override because every asset URL is
            # content-hashed in production and the user can hard-refresh
            # when developing locally.
            response.headers["Cache-Control"] = "public, max-age=3600, immutable"
        return response

    @app.route("/")
    def index():
        return render_template("index.html")

    with app.app_context():
        if not os.environ.get("SKIP_DB_INIT"):
            db.create_all()
            _seed_default_budget_categories(app)

    if not app.debug and not app.testing:
        # Use a structured-ish format with timestamp, level, and module.
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        )

    return app


__all__ = ["create_app", "cors", "db", "limiter"]


def request_is_static() -> bool:
    """True if the current request is for a /static/* asset."""
    from flask import request

    return request.path.startswith("/static/")
