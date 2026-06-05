"""Health stats and heatmap endpoints."""

from __future__ import annotations

from datetime import timedelta

from flask import Blueprint, jsonify, request
from sqlalchemy import and_

from ...extensions import db
from ...models import HealthEntry
from ...utils import utcnow

bp = Blueprint("health_stats", __name__)


@bp.route("/stats", methods=["GET"])
def stats():
    days = request.args.get("days", default=30, type=int)
    if days <= 0:
        days = 30
    today = utcnow().date()
    window_start = today - timedelta(days=days - 1)
    prev_start = window_start - timedelta(days=days)
    prev_end = window_start - timedelta(days=1)

    current = HealthEntry.query.filter(HealthEntry.date >= window_start).all()
    previous = HealthEntry.query.filter(
        and_(HealthEntry.date >= prev_start, HealthEntry.date <= prev_end)
    ).all()

    def _summarize(entries):
        weights = [e.weight for e in entries if e.weight]
        sleeps = [e.sleep_hours for e in entries if e.sleep_hours]
        steps = [e.steps for e in entries if e.steps]
        distances = [e.distance_km for e in entries if e.distance_km]
        return {
            "avg_weight": round(sum(weights) / len(weights), 1) if weights else None,
            "avg_sleep": round(sum(sleeps) / len(sleeps), 2) if sleeps else None,
            "avg_steps": round(sum(steps) / len(steps)) if steps else None,
            "avg_distance_km": (round(sum(distances) / len(distances), 2) if distances else None),
            "total_workout": sum(e.workout_minutes or 0 for e in entries),
            "total_steps": sum(steps),
            "total_distance_km": round(sum(distances), 1) if distances else 0,
            "entries_count": len(entries),
        }

    cur = _summarize(current)
    prev = _summarize(previous)

    by_day: dict[str, HealthEntry] = {e.date.isoformat(): e for e in current}
    daily: list[dict] = []
    cursor = window_start
    while cursor <= today:
        e = by_day.get(cursor.isoformat())
        daily.append(
            {
                "date": cursor.isoformat(),
                "steps": e.steps if e else None,
                "weight": e.weight if e else None,
                "sleep_hours": e.sleep_hours if e else None,
                "water_liters": e.water_liters if e else None,
                "distance_km": e.distance_km if e else None,
                "workout_minutes": e.workout_minutes if e else None,
            }
        )
        cursor += timedelta(days=1)

    mood_counts: dict[str, int] = {}
    for e in current:
        if e.mood:
            mood_counts[e.mood] = mood_counts.get(e.mood, 0) + 1

    return jsonify(
        {
            "days": days,
            "window_start": window_start.isoformat(),
            "window_end": today.isoformat(),
            "current": cur,
            "previous": prev,
            "mood_counts": mood_counts,
            "daily": daily,
        }
    )


_STEP_LEVEL_THRESHOLDS = (2500, 5000, 8000, 11000)


@bp.route("/steps-heatmap", methods=["GET"])
def steps_heatmap():
    weeks = request.args.get("weeks", default=53, type=int)
    if weeks <= 0 or weeks > 104:
        weeks = 53
    today = utcnow().date()
    end_of_week = today + timedelta(days=(6 - today.weekday()))
    grid_end = end_of_week
    grid_start = grid_end - timedelta(days=weeks * 7 - 1)

    rows = (
        db.session.query(HealthEntry.date, HealthEntry.steps)
        .filter(and_(HealthEntry.date >= grid_start, HealthEntry.date <= grid_end))
        .all()
    )
    by_day: dict[str, int] = {d.isoformat(): int(s) for d, s in rows if s is not None}

    cells: list[dict] = []
    cursor = grid_start
    while cursor <= grid_end:
        count = by_day.get(cursor.isoformat(), 0)
        level = 0
        for lvl, thr in enumerate(_STEP_LEVEL_THRESHOLDS, start=1):
            if count >= thr:
                level = lvl
        cells.append(
            {
                "date": cursor.isoformat(),
                "count": count,
                "level": level,
            }
        )
        cursor += timedelta(days=1)

    return jsonify(
        {
            "weeks": weeks,
            "start": grid_start.isoformat(),
            "end": grid_end.isoformat(),
            "goal": 10000,
            "thresholds": list(_STEP_LEVEL_THRESHOLDS),
            "cells": cells,
        }
    )
