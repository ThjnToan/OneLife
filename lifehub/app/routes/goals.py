"""Goals CRUD."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import Goal
from ..utils import apply_update, get_json_data, to_date, try_commit, utcnow

bp = Blueprint("goals", __name__, url_prefix="/api/goals")

GOAL_ALLOWED = {
    "title",
    "description",
    "category",
    "status",
    "progress",
    "target_date",
}


def _get_or_404(goal_id: int) -> Goal:
    goal = db.session.get(Goal, goal_id)
    if not goal:
        from flask import abort

        abort(404)
    return goal


@bp.route("", methods=["GET", "POST"])
def collection():
    if request.method == "GET":
        query = Goal.query
        status = request.args.get("status")
        if status:
            query = query.filter(Goal.status == status)
        items = query.order_by(Goal.created_at.desc()).all()
        return jsonify([g.to_dict() for g in items])

    data = {k: v for k, v in get_json_data().items() if k in GOAL_ALLOWED}
    data["target_date"] = to_date(data.get("target_date"))
    goal = Goal(**data)
    db.session.add(goal)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(goal.to_dict()), 201


@bp.route("/<int:goal_id>", methods=["GET", "PUT", "DELETE"])
def detail(goal_id: int):
    goal = _get_or_404(goal_id)
    if request.method == "GET":
        return jsonify(goal.to_dict())

    if request.method == "PUT":
        data = get_json_data()
        if "target_date" in data:
            data["target_date"] = to_date(data["target_date"])
        apply_update(goal, data, GOAL_ALLOWED)
        if data.get("status") == "completed" and not goal.completed_at:
            goal.completed_at = utcnow()
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(goal.to_dict())

    db.session.delete(goal)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Goal deleted"}), 200
