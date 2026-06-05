"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
import secrets
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _get_secret_key() -> str:
    """Get SECRET_KEY from env or generate a secure random one for dev.

    In production, SECRET_KEY must be set via environment variable.
    """
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    if os.environ.get("FLASK_ENV") == "production":
        raise RuntimeError("SECRET_KEY must be set in production")
    return secrets.token_hex(32)


BASE_DIR = Path(__file__).resolve().parent.parent
INSTANCE_DIR = BASE_DIR / "instance"


class BaseConfig:
    """Configuration shared by all environments."""

    SECRET_KEY: str = _get_secret_key()
    SQLALCHEMY_TRACK_MODIFICATIONS: bool = False
    SQLALCHEMY_ENGINE_OPTIONS: dict = {"pool_pre_ping": True}

    UPLOAD_FOLDER: str = os.environ.get("UPLOAD_FOLDER", str(BASE_DIR / "uploads"))
    MAX_CONTENT_LENGTH: int = _env_int("MAX_CONTENT_LENGTH_MB", 50) * 1024 * 1024

    JSON_SORT_KEYS: bool = False
    PROPAGATE_EXCEPTIONS: bool = True

    # CORS - set CORS_ORIGINS to a comma-separated list of allowed origins.
    # In production this should be a specific origin (or empty for same-origin only).
    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()
    ]

    # Rate limiting
    RATELIMIT_DEFAULT: str = os.environ.get("RATELIMIT_DEFAULT", "200 per minute")
    # Storage URI for flask-limiter. Use redis://... in multi-process
    # deployments so the limit is shared. memory:// is per-process.
    RATELIMIT_STORAGE_URL: str = os.environ.get("RATELIMIT_STORAGE_URL", "memory://")

    # Hard cap on the size of a single /api/health/ingest request.
    MAX_INGEST_BYTES: int = _env_int("MAX_INGEST_BYTES", 5 * 1024 * 1024)

    # Shared-secret for the Health Connect Android companion app's
    # POST to /api/health/ingest. Set via the INGEST_TOKEN env var.
    # The actual hash is computed at app-factory time so tests can
    # override the env var before each test. See
    # ``_compute_ingest_token_sha256`` below.
    INGEST_TOKEN_SHA256: str | None = None

    ALLOWED_EXTENSIONS: set[str] = {
        "pdf",
        "png",
        "jpg",
        "jpeg",
        "gif",
        "doc",
        "docx",
        "txt",
        "xls",
        "xlsx",
        "zip",
        "mp3",
        "mp4",
    }

    DEFAULT_BUDGET_CATEGORIES: list[dict] = [
        {"name": "Food & Dining", "budget_limit": 5_000_000, "color": "#ef4444"},
        {"name": "Transportation", "budget_limit": 2_000_000, "color": "#f97316"},
        {"name": "Housing", "budget_limit": 8_000_000, "color": "#8b5cf6"},
        {"name": "Entertainment", "budget_limit": 1_500_000, "color": "#ec4899"},
        {"name": "Health & Fitness", "budget_limit": 1_000_000, "color": "#22c55e"},
        {"name": "Shopping", "budget_limit": 3_000_000, "color": "#3b82f6"},
        {"name": "Education", "budget_limit": 1_000_000, "color": "#14b8a6"},
        {"name": "Bills & Utilities", "budget_limit": 2_000_000, "color": "#f59e0b"},
        {"name": "Investing", "budget_limit": 5_000_000, "color": "#10b981"},
        {"name": "Insurance", "budget_limit": 1_500_000, "color": "#6366f1"},
    ]


def _compute_ingest_token_sha256() -> str | None:
    """Return the SHA-256 of INGEST_TOKEN, or None if not set.

    Called at app-factory time so the value is always in sync with the
    current environment (important for tests that mutate the env).
    """
    import hashlib

    token = os.environ.get("INGEST_TOKEN")
    if not token:
        return None
    return hashlib.sha256(token.encode()).hexdigest()


class DevelopmentConfig(BaseConfig):
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        f"sqlite:///{INSTANCE_DIR / 'onelife.db'}",
    )


class TestingConfig(BaseConfig):
    TESTING = True
    DEBUG = False
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    WTF_CSRF_ENABLED = False


class ProductionConfig(BaseConfig):
    DEBUG = _env_bool("DEBUG", False)
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        f"sqlite:///{INSTANCE_DIR / 'onelife.db'}",
    )


CONFIG_MAP = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
}


def get_config(name: str | None = None) -> type[BaseConfig]:
    """Resolve a config class by name, defaulting to FLASK_ENV or production."""
    name = name or os.environ.get("FLASK_ENV", "production")
    return CONFIG_MAP.get(name, ProductionConfig)
