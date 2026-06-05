"""Flask CLI entry point.

Usage:
    flask --app manage db migrate -m "message"
    flask --app manage db upgrade
"""

from app import create_app
from app.extensions import db, migrate  # noqa: F401 (re-exported for CLI)

app = create_app()
