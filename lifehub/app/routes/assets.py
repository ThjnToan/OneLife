"""Asset CRUD + quick value update."""

from __future__ import annotations

from datetime import date

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import Asset, AssetValuation
from ..services.asset_valuation import record_valuation
from ..utils import apply_update, get_json_data, try_commit, utcnow

bp = Blueprint("assets", __name__, url_prefix="/api/assets")

ASSET_ALLOWED = {
    "name",
    "asset_type",
    "current_value",
    "cost_basis",
    "quantity",
    "unit",
    "broker_platform",
    "notes",
}


def _get_or_404(asset_id: int) -> Asset:
    asset = db.session.get(Asset, asset_id)
    if not asset:
        from flask import abort

        abort(404)
    return asset


def _record_valuation_if_value_present(
    asset: Asset,
    payload: dict,
    *,
    allow_backdate: bool = False,
) -> None:
    """Record a daily snapshot when the payload sets ``current_value``.

    No-op if the value is missing or non-numeric. The caller is
    responsible for deciding when to call this (e.g. only when the
    value actually changed in a PUT).

    With ``allow_backdate=True`` the caller can pass ``valuation_date``
    (YYYY-MM-DD) to record against a day other than today.
    """
    if "current_value" not in payload:
        return
    try:
        new_value = float(payload["current_value"])
    except (TypeError, ValueError):
        return
    snapshot_day: date | None = None
    if allow_backdate:
        raw = payload.get("valuation_date")
        if raw:
            try:
                snapshot_day = date.fromisoformat(str(raw))
            except (TypeError, ValueError):
                snapshot_day = None
    if asset.id is not None:
        record_valuation(asset.id, new_value, day=snapshot_day)


@bp.route("", methods=["GET", "POST"])
def collection():
    if request.method == "GET":
        query = Asset.query
        asset_type = request.args.get("type")
        if asset_type:
            query = query.filter(Asset.asset_type == asset_type)
        items = query.order_by(Asset.created_at.desc()).all()
        include_history = request.args.get("with_history", "").lower() in {"1", "true", "yes"}
        return jsonify([a.to_dict(include_valuation_history=include_history) for a in items])

    raw = get_json_data()
    data = {k: v for k, v in raw.items() if k in ASSET_ALLOWED}
    if not data or not data.get("name"):
        return jsonify({"error": "Name is required"}), 400
    if not data.get("asset_type"):
        return jsonify({"error": "Asset type is required"}), 400
    if not isinstance(data.get("current_value"), int | float) or data["current_value"] < 0:
        return jsonify({"error": "Current value must be >= 0"}), 400
    asset = Asset(**data)
    db.session.add(asset)
    # Flush so the asset gets an id we can use for the valuation row.
    db.session.flush()
    if "current_value" in data:
        # Pass the unfiltered payload so ``valuation_date`` is visible.
        _record_valuation_if_value_present(asset, raw, allow_backdate=True)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(asset.to_dict(include_valuation_history=True)), 201


@bp.route("/<int:asset_id>", methods=["GET", "PUT", "DELETE"])
def detail(asset_id: int):
    asset = _get_or_404(asset_id)
    if request.method == "GET":
        return jsonify(asset.to_dict(include_valuation_history=True))

    if request.method == "PUT":
        raw = get_json_data()
        prev_value = asset.current_value
        apply_update(asset, raw, ASSET_ALLOWED)
        asset.updated_at = utcnow()
        # Only record when the value actually changed; the comparison
        # must use the previous value, not the post-update one.
        if "current_value" in raw and asset.current_value != prev_value:
            _record_valuation_if_value_present(asset, raw, allow_backdate=True)
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(asset.to_dict(include_valuation_history=True))

    db.session.delete(asset)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Asset deleted"}), 200


@bp.route("/<int:asset_id>/value", methods=["PATCH"])
def update_value(asset_id: int):
    """Quick endpoint to update just the current value of an asset.

    The new value is recorded against today's local date; re-PATCHing
    the same value on the same day overwrites the snapshot (so the
    user can correct a typo).
    """
    asset = _get_or_404(asset_id)
    data = get_json_data()
    if "current_value" not in data:
        return jsonify({"error": "current_value is required"}), 400
    try:
        new_value = float(data["current_value"])
    except (TypeError, ValueError):
        return jsonify({"error": "current_value must be a number"}), 400
    if new_value < 0:
        return jsonify({"error": "Current value must be >= 0"}), 400
    asset.current_value = new_value
    asset.updated_at = utcnow()
    record_valuation(asset.id, new_value, day=date.today())
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(asset.to_dict(include_valuation_history=True))


@bp.route("/<int:asset_id>/valuations", methods=["GET"])
def list_valuations(asset_id: int):
    """Full daily-valuation history for the asset.

    Query params:
      days: int, optional; if set, only return valuations within the
            last N days. Omit for the full history.
    """
    asset = _get_or_404(asset_id)
    raw_days = request.args.get("days")
    days: int | None = None
    if raw_days is not None:
        try:
            days = int(raw_days)
            if days <= 0:
                return jsonify({"error": "days must be > 0"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "days must be an integer"}), 400
    rows = AssetValuation.history_for_asset(asset.id, days=days)
    return jsonify(
        {
            "asset_id": asset.id,
            "days": days,
            "valuations": [v.to_dict() for v in rows],
        }
    )
