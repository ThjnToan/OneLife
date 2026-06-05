"""HealthEntry CRUD operations."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ...extensions import db
from ...models import HealthEntry
from ...schemas import HealthEntrySchema
from ...schemas.validation import validate_json
from ...utils import apply_update, to_date, try_commit

bp = Blueprint("health_crud", __name__)

HEALTH_ALLOWED = {
    "date",
    "weight",
    "steps",
    "workout_minutes",
    "mood",
    "sleep_hours",
    "water_liters",
    "calories_in",
    "calories_out",
    "distance_km",
    "step_calorie",
    "notes",
}


@bp.route("", methods=["GET", "POST"])
@validate_json(HealthEntrySchema)
def collection():
    if request.method == "GET":
        limit = request.args.get("limit", 30, type=int)
        items = HealthEntry.query.order_by(HealthEntry.date.desc()).limit(limit).all()
        return jsonify([e.to_dict() for e in items])

    data = request.validated_data  # type: ignore[attr-defined]
    data["date"] = to_date(data.get("date"))
    entry = HealthEntry(**data)
    db.session.add(entry)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(entry.to_dict()), 201


@bp.route("/<int:entry_id>", methods=["GET", "PUT", "DELETE"])
def detail(entry_id: int):
    entry = db.session.get(HealthEntry, entry_id)
    if not entry:
        from flask import abort

        abort(404)

    if request.method == "GET":
        return jsonify(entry.to_dict())

    if request.method == "PUT":
        schema = HealthEntrySchema(partial=True)
        try:
            data = request.get_json(force=True, silent=False) or {}
            if not isinstance(data, dict):
                return jsonify({"error": "Request body must be a JSON object"}), 400
            validated = schema.load(data)
            if "date" in validated:
                validated["date"] = to_date(validated["date"])
            apply_update(entry, validated, HEALTH_ALLOWED)
        except Exception as exc:
            return jsonify({"error": str(exc)}), 400
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(entry.to_dict())

    db.session.delete(entry)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Entry deleted"}), 200
