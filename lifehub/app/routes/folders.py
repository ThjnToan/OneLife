"""Folder CRUD with cycle detection."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import Document, Folder
from ..utils import get_json_data, try_commit

bp = Blueprint("folders", __name__, url_prefix="/api/folders")


def _get_or_404(folder_id: int) -> Folder:
    folder = db.session.get(Folder, folder_id)
    if not folder:
        from flask import abort

        abort(404)
    return folder


def _descendant_ids(folder: Folder) -> set[int]:
    """All descendant folder IDs (including self) to prevent circular moves."""
    ids = {folder.id}
    stack = list(folder.children)
    while stack:
        f = stack.pop()
        if f.id in ids:
            continue
        ids.add(f.id)
        stack.extend(f.children)
    return ids


@bp.route("", methods=["GET", "POST"])
def collection():
    if request.method == "GET":
        parent_id = request.args.get("parent_id")
        if parent_id in (None, "root", ""):
            query = Folder.query.filter(Folder.parent_id.is_(None))
        else:
            try:
                pid = int(parent_id)
            except ValueError:
                return jsonify({"error": "Invalid parent_id"}), 400
            query = Folder.query.filter(Folder.parent_id == pid)
        items = query.order_by(Folder.name.asc()).all()
        return jsonify([f.to_dict(include_path=True) for f in items])

    data = get_json_data()
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Folder name is required"}), 400
    parent_id = data.get("parent_id")
    if parent_id not in (None, "", "root"):
        try:
            parent_id = int(parent_id)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid parent_id"}), 400
        if not db.session.get(Folder, parent_id):
            return jsonify({"error": "Parent folder not found"}), 400
    else:
        parent_id = None
    folder = Folder(name=name, parent_id=parent_id)
    db.session.add(folder)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(folder.to_dict(include_path=True)), 201


@bp.route("/<int:folder_id>", methods=["GET", "PUT", "DELETE"])
def detail(folder_id: int):
    folder = _get_or_404(folder_id)
    if request.method == "GET":
        return jsonify(folder.to_dict(include_path=True))

    if request.method == "PUT":
        data = get_json_data()
        if "name" in data:
            name = (data["name"] or "").strip()
            if not name:
                return jsonify({"error": "Folder name cannot be empty"}), 400
            folder.name = name
        if "parent_id" in data:
            new_parent_id = data["parent_id"]
            if new_parent_id in (None, "", "root"):
                new_parent_id = None
            else:
                try:
                    new_parent_id = int(new_parent_id)
                except (TypeError, ValueError):
                    return jsonify({"error": "Invalid parent_id"}), 400
            if new_parent_id == folder.id:
                return jsonify({"error": "A folder cannot be its own parent"}), 400
            if new_parent_id is not None:
                if not db.session.get(Folder, new_parent_id):
                    return jsonify({"error": "Destination folder not found"}), 400
                if new_parent_id in _descendant_ids(folder):
                    return (
                        jsonify({"error": "Cannot move a folder into one of its descendants"}),
                        400,
                    )
            folder.parent_id = new_parent_id
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(folder.to_dict(include_path=True))

    for child in list(folder.children):
        child.parent_id = folder.parent_id
    for doc in list(folder.documents):
        doc.folder_id = folder.parent_id
    db.session.delete(folder)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Folder deleted; contents moved to parent"}), 200


@bp.route("/<int:folder_id>/contents", methods=["GET"])
def contents(folder_id: int):
    folder = _get_or_404(folder_id)
    subfolders = (
        Folder.query.filter(Folder.parent_id == folder_id).order_by(Folder.name.asc()).all()
    )
    docs = (
        Document.query.filter(Document.folder_id == folder_id)
        .order_by(Document.upload_date.desc())
        .all()
    )
    return jsonify(
        {
            "folder": folder.to_dict(include_path=True),
            "subfolders": [f.to_dict() for f in subfolders],
            "documents": [d.to_dict() for d in docs],
            "total_size": sum(d.file_size or 0 for d in docs),
            "file_count": len(docs),
            "folder_count": len(subfolders),
        }
    )


@bp.route("/breadcrumbs", methods=["GET"])
def breadcrumbs():
    """Return full breadcrumb path for a given folder_id (or root)."""
    folder_id = request.args.get("folder_id")
    if not folder_id or folder_id == "root":
        return jsonify({"path": [], "folder": None})
    try:
        fid = int(folder_id)
    except ValueError:
        return jsonify({"error": "Invalid folder_id"}), 400
    folder = _get_or_404(fid)
    return jsonify({"path": folder.get_path(), "folder": folder.to_dict()})
