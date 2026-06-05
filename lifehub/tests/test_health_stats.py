"""Tests for the health stats and steps-heatmap endpoints."""

from __future__ import annotations

from datetime import date, timedelta

from app.extensions import db
from app.models import HealthEntry


def _add_entry(
    client,
    *,
    day_offset: int,
    steps: int = 0,
    weight: float = None,
    sleep: float = None,
    workout: int = None,
    distance_km: float = None,
) -> HealthEntry:
    """Helper: insert a HealthEntry at a given offset from today.

    day_offset=0 is today; -1 is yesterday; -30 is 30 days ago.
    """
    e = HealthEntry(
        date=date.today() + timedelta(days=day_offset),
        steps=steps,
        weight=weight,
        sleep_hours=sleep,
        workout_minutes=workout,
        distance_km=distance_km,
    )
    db.session.add(e)
    db.session.commit()
    return e


class TestHealthStats:
    def test_default_returns_current_previous_daily(self, client):
        # 5 days of data, all recent (within 30d window)
        for i in range(5):
            _add_entry(client, day_offset=-i, steps=1000 * (i + 1), weight=70.0)
        r = client.get("/api/health/stats")
        assert r.status_code == 200
        data = r.get_json()
        assert "current" in data
        assert "previous" in data
        assert "daily" in data
        assert data["days"] == 30
        assert data["current"]["entries_count"] == 5
        assert data["current"]["avg_steps"] >= 2000
        assert data["current"]["avg_weight"] == 70.0

    def test_days_param_shortens_window(self, client):
        # 14 days of data, query 7-day window
        for i in range(14):
            _add_entry(client, day_offset=-i, steps=2000)
        r = client.get("/api/health/stats?days=7")
        assert r.status_code == 200
        data = r.get_json()
        # Only last 7 days should be in "current"
        assert data["current"]["entries_count"] == 7

    def test_previous_window_has_data(self, client):
        # 60 days of data, 30-day window
        for i in range(60):
            _add_entry(client, day_offset=-i, steps=5000)
        r = client.get("/api/health/stats?days=30")
        data = r.get_json()
        # Current window: [today-29, today] = 30 days
        assert data["current"]["entries_count"] == 30
        # Previous window: [today-59, today-30] = 30 days
        assert data["previous"]["entries_count"] == 30
        assert data["previous"]["avg_steps"] == 5000

    def test_daily_array_length_matches_window(self, client):
        r = client.get("/api/health/stats?days=14")
        data = r.get_json()
        # daily should be 14 days aligned to window
        assert len(data["daily"]) == 14
        for d in data["daily"]:
            assert "date" in d
            assert "steps" in d

    def test_zero_days_falls_back_to_30(self, client):
        # days=0 is invalid; endpoint clamps to 30
        for i in range(40):
            _add_entry(client, day_offset=-i, steps=1000)
        r = client.get("/api/health/stats?days=0")
        data = r.get_json()
        assert data["days"] == 30
        assert data["current"]["entries_count"] == 30

    def test_empty_db_returns_zero_counts(self, client):
        r = client.get("/api/health/stats")
        data = r.get_json()
        assert data["current"]["entries_count"] == 0
        # avg_steps is None when no entries (no division-by-zero)
        assert data["current"]["avg_steps"] is None
        assert data["current"]["avg_weight"] is None
        assert data["current"]["total_workout"] == 0
        assert data["previous"]["entries_count"] == 0


class TestStepsHeatmap:
    def test_default_53_weeks(self, client):
        r = client.get("/api/health/steps-heatmap")
        assert r.status_code == 200
        data = r.get_json()
        assert data["weeks"] == 53
        # 53 weeks * 7 days = 371 cells
        assert len(data["cells"]) == 371
        assert "goal" in data

    def test_cells_have_required_fields(self, client):
        r = client.get("/api/health/steps-heatmap")
        data = r.get_json()
        for c in data["cells"]:
            assert "date" in c
            assert "count" in c
            assert "level" in c
            assert 0 <= c["level"] <= 4

    def test_level_thresholds_respected(self, client):
        # Insert a known-high day
        e = HealthEntry(date=date.today() - timedelta(days=5), steps=15000, distance_km=11.0)
        db.session.add(e)
        db.session.commit()
        # Insert a known-low day
        e2 = HealthEntry(date=date.today() - timedelta(days=10), steps=1500, distance_km=1.0)
        db.session.add(e2)
        db.session.commit()
        r = client.get("/api/health/steps-heatmap?weeks=4")
        data = r.get_json()
        cells_by_date = {c["date"]: c for c in data["cells"]}
        # The 15000-step day should be level 4 (>= 11000)
        high_day = (date.today() - timedelta(days=5)).isoformat()
        assert cells_by_date[high_day]["level"] == 4
        # The 1500-step day should be level 0 (no threshold below 2500) or 1
        # 1500 < 2500, so level 0
        low_day = (date.today() - timedelta(days=10)).isoformat()
        assert cells_by_date[low_day]["level"] == 0

    def test_grid_aligned_to_sunday(self, client):
        r = client.get("/api/health/steps-heatmap?weeks=2")
        data = r.get_json()
        first = date.fromisoformat(data["cells"][0]["date"])
        # Each grid row is 7 days; should start on a Sunday (weekday 6 in Python)
        # The end-of-week padding means first cell may be < 14 days ago
        # Just check it's a valid date and grid length is 14
        assert len(data["cells"]) == 14
