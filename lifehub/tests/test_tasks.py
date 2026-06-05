"""Tests for the Task resource and habit streak logic."""

from __future__ import annotations

from datetime import date, timedelta

from app.extensions import db
from app.models import Task
from app.services.tasks import (
    decrement_streak_on_uncomplete,
    update_streak_on_complete,
)


def test_create_task_minimal(client):
    response = client.post("/api/tasks", json={"title": "Buy milk"})
    assert response.status_code == 201
    payload = response.get_json()
    assert payload["title"] == "Buy milk"
    assert payload["status"] == "pending"
    assert payload["streak"] == 0


def test_create_task_requires_title(client):
    response = client.post("/api/tasks", json={"description": "missing title"})
    assert response.status_code == 400


def test_list_tasks_returns_array(client):
    client.post("/api/tasks", json={"title": "A"})
    client.post("/api/tasks", json={"title": "B"})
    response = client.get("/api/tasks")
    assert response.status_code == 200
    assert isinstance(response.get_json(), list)
    assert len(response.get_json()) == 2


def test_update_task_status_to_completed(client):
    client.post("/api/tasks", json={"title": "A"})
    response = client.put("/api/tasks/1", json={"status": "completed"})
    assert response.status_code == 200
    assert response.get_json()["status"] == "completed"
    assert response.get_json()["completed_at"] is not None


def test_delete_task(client):
    client.post("/api/tasks", json={"title": "A"})
    response = client.delete("/api/tasks/1")
    assert response.status_code == 200
    response = client.get("/api/tasks")
    assert response.get_json() == []


def test_habit_streak_first_completion(app):
    with app.app_context():
        task = Task(title="Read", is_habit=True, habit_frequency="daily")
        db.session.add(task)
        db.session.commit()

        today = date(2026, 6, 1)
        update_streak_on_complete(task, today=today)
        assert task.streak == 1
        assert task.last_completed_on == today


def test_habit_streak_does_not_double_count_same_day(app):
    with app.app_context():
        task = Task(title="Read", is_habit=True, habit_frequency="daily")
        db.session.add(task)
        db.session.commit()
        today = date(2026, 6, 1)
        update_streak_on_complete(task, today=today)
        update_streak_on_complete(task, today=today)
        assert task.streak == 1


def test_habit_streak_increments_within_window(app):
    with app.app_context():
        task = Task(title="Read", is_habit=True, habit_frequency="daily")
        db.session.add(task)
        db.session.commit()
        day1 = date(2026, 6, 1)
        day2 = day1 + timedelta(days=1)
        update_streak_on_complete(task, today=day1)
        update_streak_on_complete(task, today=day2)
        assert task.streak == 2


def test_habit_streak_resets_after_missed_window(app):
    with app.app_context():
        task = Task(title="Read", is_habit=True, habit_frequency="daily")
        db.session.add(task)
        db.session.commit()
        day1 = date(2026, 6, 1)
        day_late = day1 + timedelta(days=5)  # 4-day gap
        update_streak_on_complete(task, today=day1)
        update_streak_on_complete(task, today=day_late)
        assert task.streak == 1  # reset


def test_habit_streak_decrement(app):
    with app.app_context():
        task = Task(title="Read", is_habit=True, habit_frequency="daily", streak=3)
        db.session.add(task)
        db.session.commit()
        decrement_streak_on_uncomplete(task)
        assert task.streak == 2
        decrement_streak_on_uncomplete(task)
        decrement_streak_on_uncomplete(task)
        decrement_streak_on_uncomplete(task)  # floor at 0
        assert task.streak == 0
