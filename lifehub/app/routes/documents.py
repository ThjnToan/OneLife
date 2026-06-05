"""Document upload / list / download / preview endpoints."""

from __future__ import annotations

from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from ..extensions import db
from ..models import Document, Folder
from ..utils import apply_update, get_json_data, try_commit, utcnow

bp = Blueprint("documents", __name__, url_prefix="/api/documents")

DOC_ALLOWED = {"description", "category", "tags", "folder_id", "original_name"}


def _allowed_file(filename: str) -> bool:
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in current_app.config["ALLOWED_EXTENSIONS"]
    )


def _resolve_folder_id(raw: str | None) -> int | None:
    if not raw or raw == "root":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


@bp.route("", methods=["GET", "POST"])
def collection():
    if request.method == "GET":
        query = Document.query
        category = request.args.get("category")
        folder_id = request.args.get("folder_id")
        if category:
            query = query.filter(Document.category == category)
        if folder_id is not None:
            if folder_id in ("root", ""):
                query = query.filter(Document.folder_id.is_(None))
            else:
                fid = _resolve_folder_id(folder_id)
                if fid is None:
                    return jsonify({"error": "Invalid folder_id"}), 400
                query = query.filter(Document.folder_id == fid)
        items = query.order_by(Document.upload_date.desc()).all()
        return jsonify([d.to_dict() for d in items])

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400
    if not file or not _allowed_file(file.filename):
        return jsonify({"error": "File type not allowed"}), 400

    filename = secure_filename(file.filename)
    timestamp = utcnow().strftime("%Y%m%d_%H%M%S")
    unique_filename = f"{timestamp}_{filename}"
    upload_folder = Path(current_app.config["UPLOAD_FOLDER"])
    upload_folder.mkdir(parents=True, exist_ok=True)
    filepath = upload_folder / unique_filename
    file.save(str(filepath))

    folder_id = _resolve_folder_id(request.form.get("folder_id"))
    if folder_id is not None and not db.session.get(Folder, folder_id):
        return jsonify({"error": "Destination folder not found"}), 400

    doc = Document(
        filename=unique_filename,
        original_name=filename,
        file_type=filename.rsplit(".", 1)[1].lower(),
        file_size=filepath.stat().st_size,
        description=request.form.get("description", ""),
        category=request.form.get("category", "other"),
        tags=request.form.get("tags", ""),
        folder_id=folder_id,
    )
    db.session.add(doc)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(doc.to_dict()), 201


@bp.route("/<int:doc_id>", methods=["GET", "PUT", "DELETE"])
def detail(doc_id: int):
    doc = db.session.get(Document, doc_id)
    if not doc:
        from flask import abort

        abort(404)

    if request.method == "GET":
        return send_from_directory(
            current_app.config["UPLOAD_FOLDER"],
            doc.filename,
            as_attachment=True,
            download_name=doc.original_name,
        )

    if request.method == "PUT":
        data = get_json_data()
        if "folder_id" in data:
            fid = _resolve_folder_id(data["folder_id"])
            if fid is not None and not db.session.get(Folder, fid):
                return jsonify({"error": "Destination folder not found"}), 400
            data["folder_id"] = fid
        if "original_name" in data and (
            not data["original_name"] or not str(data["original_name"]).strip()
        ):
            return jsonify({"error": "Name cannot be empty"}), 400
        apply_update(doc, data, DOC_ALLOWED)
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(doc.to_dict()), 200

    filepath = Path(current_app.config["UPLOAD_FOLDER"]) / doc.filename
    if filepath.exists():
        filepath.unlink()
    db.session.delete(doc)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Document deleted"}), 200


@bp.route("/<int:doc_id>/preview", methods=["GET"])
def preview(doc_id: int):
    doc = db.session.get(Document, doc_id)
    if not doc:
        from flask import abort

        abort(404)
    return send_from_directory(
        current_app.config["UPLOAD_FOLDER"],
        doc.filename,
        as_attachment=False,
        download_name=doc.original_name,
    )
