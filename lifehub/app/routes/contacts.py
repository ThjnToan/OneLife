"""Contact directory."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import Contact
from ..utils import apply_update, get_json_data, to_date, try_commit

bp = Blueprint("contacts", __name__, url_prefix="/api/contacts")

CONTACT_ALLOWED = {
    "name",
    "email",
    "phone",
    "address",
    "birthday",
    "company",
    "job_title",
    "category",
    "notes",
}


def _get_or_404(contact_id: int) -> Contact:
    contact = db.session.get(Contact, contact_id)
    if not contact:
        from flask import abort

        abort(404)
    return contact


@bp.route("", methods=["GET", "POST"])
def collection():
    if request.method == "GET":
        query = Contact.query
        category = request.args.get("category")
        if category:
            query = query.filter(Contact.category == category)
        items = query.order_by(Contact.name.asc()).all()
        return jsonify([c.to_dict() for c in items])

    data = {k: v for k, v in get_json_data().items() if k in CONTACT_ALLOWED}
    data["birthday"] = to_date(data.get("birthday"))
    contact = Contact(**data)
    db.session.add(contact)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(contact.to_dict()), 201


@bp.route("/<int:contact_id>", methods=["GET", "PUT", "DELETE"])
def detail(contact_id: int):
    contact = _get_or_404(contact_id)
    if request.method == "GET":
        return jsonify(contact.to_dict())

    if request.method == "PUT":
        data = get_json_data()
        if "birthday" in data:
            data["birthday"] = to_date(data["birthday"])
        apply_update(contact, data, CONTACT_ALLOWED)
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(contact.to_dict())

    db.session.delete(contact)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Contact deleted"}), 200
