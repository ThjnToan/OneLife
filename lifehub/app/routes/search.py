"""Cross-module search for the command palette."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..models import (
    Asset,
    CalendarEvent,
    Contact,
    Goal,
    JournalEntry,
    LearningItem,
    Task,
)
from ..utils import format_currency

bp = Blueprint("search", __name__, url_prefix="/api")

_SOURCES = [
    (Task, ["title", "description"], "task", "tasks", lambda t: t.status),
    (
        Contact,
        ["name", "email", "company"],
        "contact",
        "contacts",
        lambda c: c.email or c.phone or "",
    ),
    (
        JournalEntry,
        ["title", "content"],
        "journal",
        "journal",
        lambda j: j.date.isoformat() if j.date else "",
    ),
    (
        LearningItem,
        ["title", "notes", "author"],
        "learning",
        "learning",
        lambda item: f"{item.item_type} - {item.status}",
    ),
    (
        CalendarEvent,
        ["title", "description", "location"],
        "event",
        "calendar",
        lambda e: e.start_time.isoformat() if e.start_time else "",
    ),
    (Goal, ["title", "description"], "goal", "goals", lambda g: g.status),
    (
        Asset,
        ["name", "notes", "broker_platform"],
        "asset",
        "finance",
        lambda a: format_currency(a.current_value),
    ),
]


@bp.route("/search", methods=["GET"])
def search_all():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": []})

    results: list[dict] = []
    pattern = f"%{q}%"
    for model, fields, type_, section, subtitle_fn in _SOURCES:
        conds = [getattr(model, f).ilike(pattern) for f in fields]
        from sqlalchemy import or_

        query = model.query.filter(or_(*conds)).limit(5).all()
        for item in query:
            title = item.title if hasattr(item, "title") else item.name
            results.append(
                {
                    "type": type_,
                    "id": item.id,
                    "title": title,
                    "subtitle": subtitle_fn(item),
                    "section": section,
                }
            )
    return jsonify({"results": results})
