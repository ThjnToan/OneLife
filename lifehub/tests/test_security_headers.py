"""Tests for static caching, security headers, and the import/export flow."""

from __future__ import annotations

import json


def test_static_assets_get_long_cache(client):
    """Static assets are content-hashed by Flask; they should be cached for an hour."""
    rv = client.get("/static/img/logo.svg")
    assert rv.status_code == 200
    cc = rv.headers.get("Cache-Control", "")
    assert "max-age=3600" in cc
    assert "immutable" in cc


def test_json_endpoints_have_no_long_cache(client):
    """API responses are dynamic; they must not be cached for an hour."""
    rv = client.get("/api/export")
    assert rv.status_code == 200
    cc = rv.headers.get("Cache-Control", "")
    assert "max-age=3600" not in cc


def test_security_headers_on_api(client):
    rv = client.get("/api/export")
    assert rv.headers.get("X-Content-Type-Options") == "nosniff"
    assert rv.headers.get("X-Frame-Options") == "DENY"
    assert rv.headers.get("Referrer-Policy") == "same-origin"


def test_export_then_import_round_trip(client, app):
    # Wipe the default budget categories seeded at app-start so the
    # round-trip doesn't conflict on UNIQUE(name).
    from app.extensions import db
    from app.models import BudgetCategory

    with app.app_context():
        db.session.query(BudgetCategory).delete()
        db.session.commit()

    client.post("/api/tasks", json={"title": "T1"})
    client.post(
        "/api/assets",
        json={"name": "Cash", "asset_type": "cash", "current_value": 100},
    )
    rv = client.get("/api/export")
    assert rv.status_code == 200
    payload = rv.get_json()
    assert payload["schema_version"] >= 3
    assert "heart_rate_samples" in payload
    assert "sleep_sessions" in payload
    assert "user_settings" in payload

    # Re-import the same payload.
    rv = client.post(
        "/api/import",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert rv.status_code == 200, rv.get_data(as_text=True)
    body = rv.get_json()
    assert body["counts"]["tasks"] == 1
    assert body["counts"]["assets"] == 1


def test_import_rolls_back_on_bad_row(client, app):
    """A malformed row in any table must not destroy existing data."""
    client.post("/api/tasks", json={"title": "keep me"})

    bad = {
        "tasks": [
            {"title": "imported"},  # valid
        ],
        "assets": [
            {"name": "X", "asset_type": "cash", "current_value": "not-a-number"},
        ],
    }
    rv = client.post(
        "/api/import",
        data=json.dumps(bad),
        content_type="application/json",
    )
    assert rv.status_code == 400

    # Existing data must still be there.
    rv = client.get("/api/export")
    payload = rv.get_json()
    titles = [t["title"] for t in payload["tasks"]]
    assert "keep me" in titles
    assert "imported" not in titles


def test_ingest_respects_max_ingest_bytes(client, app, monkeypatch):
    """Oversized bodies are rejected with 413 before being read."""
    from tests.test_samsung_health import _set_ingest_token

    token = _set_ingest_token(monkeypatch, app)
    app.config["MAX_INGEST_BYTES"] = 100
    big = "x" * 200
    rv = client.post(
        "/api/health/ingest",
        data=big,
        content_type="application/json",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert rv.status_code == 413
