"""Asset-related business logic (syncing with transactions, validation)."""

from __future__ import annotations

from sqlalchemy import func

from ..extensions import db
from ..models import Asset


def asset_breakdown() -> list[dict]:
    """Return per-asset-type summary with value, cost, count, and gain."""
    rows = (
        db.session.query(
            Asset.asset_type,
            func.sum(Asset.current_value),
            func.sum(Asset.cost_basis),
            func.count(Asset.id),
        )
        .group_by(Asset.asset_type)
        .all()
    )
    return [
        {
            "type": r[0],
            "value": float(r[1] or 0),
            "cost": float(r[2] or 0),
            "count": r[3],
            "gain": float((r[1] or 0) - (r[2] or 0)),
        }
        for r in rows
    ]


def sync_asset_from_transaction(tx, asset_id: int | None) -> None:
    """Apply a transaction's effect to a linked asset.

    - ``income`` (money in): increases both ``current_value`` and ``cost_basis``.
    - ``expense`` (money out): decreases only ``current_value``. The
      cost basis of a cash / savings account represents total deposits, which
      doesn't shrink when you spend from it.
    """
    if asset_id is None:
        return
    asset: Asset | None = db.session.get(Asset, asset_id)
    if not asset:
        return
    if tx.type == "income":
        asset.current_value = (asset.current_value or 0) + tx.amount
        asset.cost_basis = (asset.cost_basis or 0) + tx.amount
    elif tx.type == "expense":
        asset.current_value = (asset.current_value or 0) - tx.amount


def reverse_asset_from_transaction(asset_id: int | None, amount: float, tx_type: str) -> None:
    """Undo a transaction's effect on a linked asset (used on edit/delete)."""
    if asset_id is None:
        return
    asset: Asset | None = db.session.get(Asset, asset_id)
    if not asset:
        return
    if tx_type == "income":
        asset.current_value = (asset.current_value or 0) - amount
        asset.cost_basis = (asset.cost_basis or 0) - amount
    else:
        asset.current_value = (asset.current_value or 0) + amount
