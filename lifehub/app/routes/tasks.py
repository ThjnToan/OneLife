"""Task CRUD with habit-streak handling."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import Task
from ..schemas import TaskSchema
from ..schemas.validation import validate_json
from ..services.tasks import (
    decrement_streak_on_uncomplete,
    update_streak_on_complete,
)
from ..utils import apply_update, parse_bool, to_date, try_commit, utcnow

bp = Blueprint("tasks", __name__, url_prefix="/api/tasks")

TASK_ALLOWED = {
    "title",
    "description",
    "category",
    "priority",
    "due_date",
    "status",
    "is_habit",
    "habit_frequency",
    "streak",
}


@bp.route("", methods=["GET", "POST"])
@validate_json(TaskSchema)
def collection():
    if request.method == "GET":
        query = Task.query
        status = request.args.get("status")
        category = request.args.get("category")
        is_habit = parse_bool(request.args.get("is_habit"))
        if status:
            query = query.filter(Task.status == status)
        if category:
            query = query.filter(Task.category == category)
        if is_habit is not None:
            query = query.filter(Task.is_habit == is_habit)
        items = query.order_by(Task.created_at.desc()).all()
        return jsonify([t.to_dict() for t in items])

    data = request.validated_data  # type: ignore[attr-defined]
    data["due_date"] = to_date(data.get("due_date"))
    task = Task(**data)
    db.session.add(task)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(task.to_dict()), 201


@bp.route("/<int:task_id>", methods=["GET", "PUT", "DELETE"])
def detail(task_id: int):
    from flask import abort

    task = db.session.get(Task, task_id)
    if not task:
        abort(404)

    if request.method == "GET":
        return jsonify(task.to_dict())

    if request.method == "PUT":
        schema = TaskSchema(partial=True)
        try:
            data = request.get_json(force=True, silent=False) or {}
            if not isinstance(data, dict):
                return jsonify({"error": "Request body must be a JSON object"}), 400
            validated = schema.load(data)
            if "due_date" in validated:
                validated["due_date"] = to_date(validated["due_date"])
            old_status = task.status
            apply_update(task, validated, TASK_ALLOWED)
            if "status" in validated and validated["status"] != old_status:
                new_status = validated["status"]
                if new_status == "completed" and old_status != "completed":
                    task.completed_at = utcnow()
                    if task.is_habit:
                        update_streak_on_complete(task)
                elif new_status != "completed" and old_status == "completed":
                    task.completed_at = None
                    if task.is_habit:
                        decrement_streak_on_uncomplete(task)
        except Exception as exc:
            return jsonify({"error": str(exc)}), 400
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(task.to_dict())

    db.session.delete(task)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Task deleted"}), 200
