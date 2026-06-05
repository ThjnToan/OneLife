"""Calendar events."""

from __future__ import annotations

from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import CalendarEvent
from ..utils import apply_update, get_json_data, to_datetime, try_commit, utcnow

bp = Blueprint("calendar", __name__, url_prefix="/api/events")

EVENT_ALLOWED = {
    "title",
    "description",
    "start_time",
    "end_time",
    "location",
    "category",
    "is_all_day",
    "reminder",
}


def _get_or_404(event_id: int) -> CalendarEvent:
    event = db.session.get(CalendarEvent, event_id)
    if not event:
        from flask import abort

        abort(404)
    return event


@bp.route("", methods=["GET", "POST"])
def collection():
    if request.method == "GET":
        query = CalendarEvent.query
        start = request.args.get("start")
        end = request.args.get("end")
        if start:
            query = query.filter(CalendarEvent.start_time >= datetime.fromisoformat(start))
        if end:
            query = query.filter(CalendarEvent.start_time <= datetime.fromisoformat(end))
        events = query.order_by(CalendarEvent.start_time.asc()).all()
        return jsonify([e.to_dict() for e in events])

    data = {k: v for k, v in get_json_data().items() if k in EVENT_ALLOWED}
    if not data or not data.get("title"):
        return jsonify({"error": "Title is required"}), 400
    if not data.get("start_time"):
        return jsonify({"error": "Start time is required"}), 400
    data["start_time"] = to_datetime(data.get("start_time"))
    if data.get("end_time"):
        data["end_time"] = to_datetime(data["end_time"])
    event = CalendarEvent(**data)
    db.session.add(event)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(event.to_dict()), 201


@bp.route("/<int:event_id>", methods=["GET", "PUT", "DELETE"])
def detail(event_id: int):
    event = _get_or_404(event_id)
    if request.method == "GET":
        return jsonify(event.to_dict())

    if request.method == "PUT":
        data = get_json_data()
        if "start_time" in data:
            data["start_time"] = to_datetime(data["start_time"])
        if data.get("end_time"):
            data["end_time"] = to_datetime(data["end_time"])
        apply_update(event, data, EVENT_ALLOWED)
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(event.to_dict())

    db.session.delete(event)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Event deleted"}), 200


@bp.route("/upcoming", methods=["GET"])
def upcoming():
    now = utcnow()
    week_later = now + timedelta(days=7)
    events = (
        CalendarEvent.query.filter(
            CalendarEvent.start_time >= now,
            CalendarEvent.start_time <= week_later,
        )
        .order_by(CalendarEvent.start_time.asc())
        .all()
    )
    return jsonify([e.to_dict() for e in events])
