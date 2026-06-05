"""Journal entries."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import JournalEntry
from ..utils import apply_update, get_json_data, parse_bool, to_date, try_commit, utcnow

bp = Blueprint("journal", __name__, url_prefix="/api/journal")

JOURNAL_ALLOWED = {"date", "title", "content", "mood", "tags", "is_favorite"}


def _get_or_404(entry_id: int) -> JournalEntry:
    entry = db.session.get(JournalEntry, entry_id)
    if not entry:
        from flask import abort

        abort(404)
    return entry


@bp.route("", methods=["GET", "POST"])
def collection():
    if request.method == "GET":
        query = JournalEntry.query
        favorite = parse_bool(request.args.get("is_favorite"))
        if favorite is not None:
            query = query.filter(JournalEntry.is_favorite == favorite)
        items = query.order_by(JournalEntry.date.desc()).all()
        return jsonify([e.to_dict() for e in items])

    data = {k: v for k, v in get_json_data().items() if k in JOURNAL_ALLOWED}
    if not data or not data.get("content"):
        return jsonify({"error": "Content is required"}), 400
    data["date"] = to_date(data.get("date"))
    entry = JournalEntry(**data)
    db.session.add(entry)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(entry.to_dict()), 201


@bp.route("/<int:entry_id>", methods=["GET", "PUT", "DELETE"])
def detail(entry_id: int):
    entry = _get_or_404(entry_id)
    if request.method == "GET":
        return jsonify(entry.to_dict())

    if request.method == "PUT":
        data = get_json_data()
        if "date" in data:
            data["date"] = to_date(data["date"])
        apply_update(entry, data, JOURNAL_ALLOWED)
        entry.updated_at = utcnow()
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(entry.to_dict())

    db.session.delete(entry)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Entry deleted"}), 200
