"""Daily valuation snapshots for assets.

The user updates an investment's value through the regular Asset
CRUD/PATCH endpoints; this helper records the new value against
``today`` (or the date the caller passes in) so we can plot the
investment over time. Latest value wins for any given day.
"""

from __future__ import annotations

from datetime import date

from ..extensions import db
from ..models import AssetValuation


def record_valuation(
    asset_id: int,
    value: float,
    day: date | None = None,
) -> AssetValuation:
    """Upsert the (asset_id, day) valuation row and return it.

    Callers do not need to commit; the row is added to ``db.session``
    in the same transaction as the asset update.
    """
    target_day = day or date.today()
    existing: AssetValuation | None = AssetValuation.query.filter(
        AssetValuation.asset_id == asset_id,
        AssetValuation.date == target_day,
    ).first()
    if existing is not None:
        existing.value = float(value)
        return existing
    row = AssetValuation(asset_id=asset_id, date=target_day, value=float(value))
    db.session.add(row)
    return row
