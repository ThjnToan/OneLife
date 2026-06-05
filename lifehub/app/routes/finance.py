"""Finance routes: transactions, budgets, monthly trend, summary."""

from __future__ import annotations

from calendar import monthrange
from datetime import date

from flask import Blueprint, jsonify, request
from sqlalchemy import func

from ..extensions import db
from ..models import Asset, BudgetCategory, FinancialTransaction
from ..schemas import BudgetCategorySchema, FinancialTransactionSchema
from ..schemas.validation import validate_json
from ..services.assets import (
    asset_breakdown,
    reverse_asset_from_transaction,
    sync_asset_from_transaction,
)
from ..services.networth import CASH_TYPES, INVESTMENT_TYPES
from ..utils import apply_update, get_json_data, to_date, try_commit

bp = Blueprint("finance", __name__, url_prefix="/api")

TX_ALLOWED = {
    "date",
    "amount",
    "type",
    "category",
    "description",
    "payment_method",
    "asset_id",
}
BUDGET_ALLOWED = {"name", "budget_limit", "color"}


@bp.route("/transactions", methods=["GET", "POST"])
@validate_json(FinancialTransactionSchema)
def transactions():
    if request.method == "GET":
        query = FinancialTransaction.query
        type_filter = request.args.get("type")
        month = request.args.get("month")
        if type_filter:
            query = query.filter(FinancialTransaction.type == type_filter)
        if month:
            try:
                year, mon = month.split("-")
            except ValueError:
                return jsonify({"error": "Invalid month format. Use YYYY-MM"}), 400
            query = query.filter(
                func.extract("year", FinancialTransaction.date) == int(year),
                func.extract("month", FinancialTransaction.date) == int(mon),
            )
        items = query.order_by(FinancialTransaction.date.desc()).all()
        return jsonify([t.to_dict() for t in items])

    data = request.validated_data  # type: ignore[attr-defined]
    data["date"] = to_date(data.get("date"))
    asset_id = data.get("asset_id")
    if asset_id is not None and not db.session.get(Asset, asset_id):
        return jsonify({"error": "Linked asset not found"}), 400
    tx = FinancialTransaction(**data)
    db.session.add(tx)
    if asset_id is not None:
        sync_asset_from_transaction(tx, asset_id)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(tx.to_dict()), 201


@bp.route("/transactions/<int:tx_id>", methods=["GET", "PUT", "DELETE"])
def transaction_detail(tx_id: int):
    tx = db.session.get(FinancialTransaction, tx_id)
    if not tx:
        from flask import abort

        abort(404)

    if request.method == "GET":
        return jsonify(tx.to_dict())

    if request.method == "PUT":
        data = get_json_data()
        if "date" in data:
            data["date"] = to_date(data["date"])
        old_asset_id = tx.asset_id
        old_amount = tx.amount
        old_type = tx.type
        apply_update(tx, data, TX_ALLOWED)
        new_asset_id = tx.asset_id
        if new_asset_id is not None and not db.session.get(Asset, new_asset_id):
            db.session.rollback()
            return jsonify({"error": "Linked asset not found"}), 400
        if old_asset_id is not None or new_asset_id is not None:
            reverse_asset_from_transaction(old_asset_id, old_amount, old_type)
            if new_asset_id is not None:
                sync_asset_from_transaction(tx, new_asset_id)
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(tx.to_dict())

    reverse_asset_from_transaction(tx.asset_id, tx.amount, tx.type)
    db.session.delete(tx)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Transaction deleted"}), 200


@bp.route("/budgets", methods=["GET", "POST"])
@validate_json(BudgetCategorySchema)
def budgets():
    if request.method == "GET":
        return jsonify([c.to_dict() for c in BudgetCategory.query.all()])
    data = request.validated_data  # type: ignore[attr-defined]
    cat = BudgetCategory(**data)
    db.session.add(cat)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify(cat.to_dict()), 201


@bp.route("/budgets/<int:cat_id>", methods=["PUT", "DELETE"])
def budget_detail(cat_id: int):
    cat = db.session.get(BudgetCategory, cat_id)
    if not cat:
        from flask import abort

        abort(404)

    if request.method == "PUT":
        schema = BudgetCategorySchema(partial=True)
        try:
            data = request.get_json(force=True, silent=False) or {}
            if not isinstance(data, dict):
                return jsonify({"error": "Request body must be a JSON object"}), 400
            validated = schema.load(data)
            for k, v in validated.items():
                if k in BUDGET_ALLOWED and hasattr(cat, k):
                    setattr(cat, k, v)
        except Exception as exc:
            return jsonify({"error": str(exc)}), 400
        err, code = try_commit(db.session)
        if err is not None:
            return err, code
        return jsonify(cat.to_dict())

    db.session.delete(cat)
    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Category deleted"}), 200


@bp.route("/finance/monthly-trend", methods=["GET"])
def monthly_trend():
    today = date.today()
    results: list[dict] = []
    for i in range(11, -1, -1):
        month = today.month - i
        year = today.year
        while month < 1:
            month += 12
            year -= 1
        while month > 12:
            month -= 12
            year += 1
        last_day = monthrange(year, month)[1]
        start = date(year, month, 1)
        end = date(year, month, last_day)
        income = (
            db.session.query(func.sum(FinancialTransaction.amount))
            .filter(
                FinancialTransaction.type == "income",
                FinancialTransaction.date >= start,
                FinancialTransaction.date <= end,
            )
            .scalar()
            or 0
        )
        expense = (
            db.session.query(func.sum(FinancialTransaction.amount))
            .filter(
                FinancialTransaction.type == "expense",
                FinancialTransaction.date >= start,
                FinancialTransaction.date <= end,
            )
            .scalar()
            or 0
        )
        results.append(
            {
                "month": f"{year}-{month:02d}",
                "label": f"Th{month}",
                "income": float(income),
                "expense": float(expense),
                "balance": float(income - expense),
            }
        )
    return jsonify(results)


@bp.route("/finance/summary", methods=["GET"])
def summary():
    today = date.today()
    first_day = today.replace(day=1)
    income = (
        db.session.query(func.sum(FinancialTransaction.amount))
        .filter(
            FinancialTransaction.type == "income",
            FinancialTransaction.date >= first_day,
        )
        .scalar()
        or 0
    )
    expense = (
        db.session.query(func.sum(FinancialTransaction.amount))
        .filter(
            FinancialTransaction.type == "expense",
            FinancialTransaction.date >= first_day,
        )
        .scalar()
        or 0
    )
    categories = (
        db.session.query(
            FinancialTransaction.category,
            func.sum(FinancialTransaction.amount),
        )
        .filter(
            FinancialTransaction.type == "expense",
            FinancialTransaction.date >= first_day,
        )
        .group_by(FinancialTransaction.category)
        .all()
    )

    cash_value = (
        db.session.query(func.sum(Asset.current_value))
        .filter(Asset.asset_type.in_(CASH_TYPES))
        .scalar()
        or 0
    )
    cash_cost = (
        db.session.query(func.sum(Asset.cost_basis))
        .filter(Asset.asset_type.in_(CASH_TYPES))
        .scalar()
        or 0
    )
    inv_value = (
        db.session.query(func.sum(Asset.current_value))
        .filter(Asset.asset_type.in_(INVESTMENT_TYPES))
        .scalar()
        or 0
    )
    inv_cost = (
        db.session.query(func.sum(Asset.cost_basis))
        .filter(Asset.asset_type.in_(INVESTMENT_TYPES))
        .scalar()
        or 0
    )
    total_assets = float(cash_value) + float(inv_value)
    total_cost = float(cash_cost) + float(inv_cost)

    return jsonify(
        {
            "month_income": float(income),
            "month_expense": float(expense),
            "month_balance": float(income - expense),
            "category_breakdown": [{"category": c[0], "amount": float(c[1])} for c in categories],
            "cash": {
                "value": float(cash_value),
                "cost": float(cash_cost),
                "gain": float(cash_value - cash_cost),
            },
            "investments": {
                "value": float(inv_value),
                "cost": float(inv_cost),
                "gain": float(inv_value - inv_cost),
            },
            "total_net_worth": total_assets,
            "total_cost": total_cost,
            "total_unrealized_gain": total_assets - total_cost,
            "asset_breakdown": asset_breakdown(),
        }
    )


@bp.route("/networth/history", methods=["GET"])
def networth_history():
    """Estimated monthly net worth for the last 12 months.

    Returns ``{"history": [...]}`` where each entry has ``month``,
    ``date``, ``net_worth``, ``cash``, and ``investments``. The current
    month is exact; earlier months are inferred from cumulative
    cashflow (best-effort until a snapshot table is added).
    """
    from ..services.networth import estimated_history

    months = request.args.get("months", default=12, type=int)
    months = max(1, min(months, 60))
    return jsonify({"history": estimated_history(months)})
