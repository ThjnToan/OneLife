"""Tests for the app factory and health endpoints."""

from __future__ import annotations


def test_index_returns_html(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"OneLife" in response.data


def test_dashboard_summary(client):
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200
    payload = response.get_json()
    assert "tasks" in payload
    assert "finance" in payload
    assert "events" in payload
    assert "goals" in payload
    # Empty DB - cash/investments should be 0
    assert payload["finance"]["net_worth"] == 0
    assert payload["tasks"]["pending"] == 0


def test_404_returns_json(client):
    response = client.get("/api/tasks/9999")
    assert response.status_code == 404
    assert "error" in response.get_json()


def test_invalid_json_returns_400(client):
    response = client.post(
        "/api/tasks",
        data="not json",
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "error" in response.get_json()
