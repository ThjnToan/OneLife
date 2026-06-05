"""Learning items CRUD."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import LearningItem
from ..utils import apply_update, get_json_data, to_date, try_commit

bp = Blueprint("learning", __name__, url_prefix="/api/learning")

LEARN_ALLOWED = {
    "title",
    "item_type",
    "status",
    "progress",
    "author",
    "url",
    "notes",
    "rating",
    "start_date",
    "end_date",
    "category",
}


def _get_or_404(item_id: int) -> LearningItem:
    item = db.session.get(LearningItem, item_id)
    if not item:
        from flask import abort

        abort(404)
    return item


@bp.route("", methods=["GET", "POST"])
def collection():
    if request.method == "GET":
        query = LearningItem.query
        item_type = request.args.get("type")
        status = request.args.get("status")
        if item_type:
            query = query.filter(LearningItem.item_type == item_type)
        if status:
            query = query.filter(LearningItem.status == status)
        items = query.order_by(LearningItem.created_at.desc()).all()
        return jsonify([i.to_dict() for i in items])

    data = {k: v for k, v in get_json_data().items() if k in LEARN_ALLOWED}
    data["start_date"] = to_date(data.get("start_date"))
    data["end_date"] = to_date(data.get("end_date"))
    item = LearningItem(**data)
    db.session.add(item)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(item.to_dict()), 201


@bp.route("/<int:item_id>", methods=["GET", "PUT", "DELETE"])
def detail(item_id: int):
    item = _get_or_404(item_id)
    if request.method == "GET":
        return jsonify(item.to_dict())

    if request.method == "PUT":
        data = get_json_data()
        if "start_date" in data:
            data["start_date"] = to_date(data["start_date"])
        if "end_date" in data:
            data["end_date"] = to_date(data["end_date"])
        apply_update(item, data, LEARN_ALLOWED)
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(item.to_dict())

    db.session.delete(item)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Item deleted"}), 200
