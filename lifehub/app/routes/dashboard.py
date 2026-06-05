"""Combined dashboard endpoint + per-section helpers."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from flask import Blueprint, jsonify
from sqlalchemy import func, union_all

from ..extensions import db
from ..models import (
    CalendarEvent,
    FinancialTransaction,
    Goal,
    HealthEntry,
    JournalEntry,
    LearningItem,
    Task,
)
from ..services.assets import asset_breakdown
from ..services.networth import net_worth_snapshot
from ..utils import utcnow

bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")


@bp.route("/summary", methods=["GET"])
def summary():
    """Single dashboard endpoint that combines stats, activity, history.

    Replaces the previous 5 round-trips per page load.
    """
    today = utcnow().date()
    first_day = today.replace(day=1)
    snapshot = net_worth_snapshot()
    breakdown = asset_breakdown()
    total_cost = sum(item["cost"] for item in breakdown)

    total_tasks = Task.query.count()
    pending = Task.query.filter(Task.status != "completed").count()
    urgent = Task.query.filter(Task.priority == "urgent", Task.status != "completed").count()
    today_health = HealthEntry.query.filter(func.date(HealthEntry.date) == today).first()

    month_income = (
        db.session.query(func.sum(FinancialTransaction.amount))
        .filter(
            FinancialTransaction.type == "income",
            FinancialTransaction.date >= first_day,
        )
        .scalar()
        or 0
    )
    month_expense = (
        db.session.query(func.sum(FinancialTransaction.amount))
        .filter(
            FinancialTransaction.type == "expense",
            FinancialTransaction.date >= first_day,
        )
        .scalar()
        or 0
    )

    upcoming = (
        CalendarEvent.query.filter(CalendarEvent.start_time >= utcnow())
        .order_by(CalendarEvent.start_time.asc())
        .limit(5)
        .all()
    )
    active_goals = Goal.query.filter(Goal.status == "active").count()
    recent_learning = LearningItem.query.order_by(LearningItem.created_at.desc()).limit(3).all()

    return jsonify(
        {
            "tasks": {
                "total": total_tasks,
                "pending": pending,
                "urgent": urgent,
            },
            "health": today_health.to_dict() if today_health else None,
            "finance": {
                "income": float(month_income),
                "expense": float(month_expense),
                "balance": float(month_income - month_expense),
                "cash": snapshot["cash"],
                "investments": snapshot["investments"],
                "net_worth": snapshot["net_worth"],
                "total_cost": total_cost,
                "unrealized_gain": snapshot["net_worth"] - total_cost,
                "asset_breakdown": breakdown,
            },
            "events": [e.to_dict() for e in upcoming],
            "goals": {"active": active_goals},
            "recent_learning": [item.to_dict() for item in recent_learning],
        }
    )


@bp.route("/stats", methods=["GET"])
def stats():
    """Alias for /summary. Kept for backward compatibility with the
    frontend which historically called this endpoint /stats."""
    return summary()


@bp.route("/activity", methods=["GET"])
def activity():
    recent_tasks = Task.query.order_by(Task.created_at.desc()).limit(5).all()
    recent_tx = (
        FinancialTransaction.query.order_by(FinancialTransaction.created_at.desc()).limit(5).all()
    )
    recent_journal = JournalEntry.query.order_by(JournalEntry.created_at.desc()).limit(3).all()

    items: list[dict] = []
    for t in recent_tasks:
        items.append(
            {
                "type": "task",
                "text": f"Task '{t.title}' - {t.status}",
                "date": t.created_at,
                "icon": "check",
            }
        )
    for t in recent_tx:
        items.append(
            {
                "type": "transaction",
                "text": f"{t.type}: {t.description} (${t.amount})",
                "date": t.created_at,
                "icon": "dollar",
            }
        )
    for j in recent_journal:
        items.append(
            {
                "type": "journal",
                "text": f"Journal: {j.title or 'Entry'}",
                "date": j.created_at,
                "icon": "book",
            }
        )
    items.sort(key=lambda x: x["date"] or datetime.min, reverse=True)

    return jsonify(
        [
            {
                "type": i["type"],
                "text": i["text"],
                "date": i["date"].isoformat() if i["date"] else None,
                "icon": i["icon"],
            }
            for i in items[:10]
        ]
    )


@bp.route("/cashflow-history", methods=["GET"])
def cashflow_history():
    from calendar import monthrange

    today = date.today()
    history: list[dict] = []
    for i in range(5, -1, -1):
        year = today.year
        month = today.month - i
        while month < 1:
            month += 12
            year -= 1
        first = date(year, month, 1)
        last = date(year, month, monthrange(year, month)[1])
        income = (
            db.session.query(func.sum(FinancialTransaction.amount))
            .filter(
                FinancialTransaction.type == "income",
                FinancialTransaction.date >= first,
                FinancialTransaction.date <= last,
            )
            .scalar()
            or 0
        )
        expense = (
            db.session.query(func.sum(FinancialTransaction.amount))
            .filter(
                FinancialTransaction.type == "expense",
                FinancialTransaction.date >= first,
                FinancialTransaction.date <= last,
            )
            .scalar()
            or 0
        )
        history.append(
            {
                "year": year,
                "month": month,
                "income": float(income),
                "expense": float(expense),
                "balance": float(income - expense),
            }
        )
    return jsonify({"history": history})


@bp.route("/activity-heatmap", methods=["GET"])
def activity_heatmap():
    today = date.today()
    weeks = 16
    start = today - timedelta(days=weeks * 7 - 1)
    grid_start = start - timedelta(days=start.weekday())

    # One round-trip: union per-source dates and group by day in SQL.
    # Replaces 4 separate queries (one per source).
    per_source = union_all(
        db.session.query(Task.created_at.label("d")),
        db.session.query(JournalEntry.date.label("d")),
        db.session.query(HealthEntry.date.label("d")),
        db.session.query(FinancialTransaction.date.label("d")),
    ).subquery()
    counts: dict[str, int] = {}
    for (raw,) in (
        db.session.query(per_source.c.d).filter(per_source.c.d >= grid_start).all()
    ):
        if raw is None:
            continue
        d_obj = raw.date() if hasattr(raw, "date") and callable(raw.date) else raw
        counts[d_obj.isoformat()] = counts.get(d_obj.isoformat(), 0) + 1

    cells: list[dict] = []
    cursor = grid_start
    while cursor <= today:
        count = counts.get(cursor.isoformat(), 0)
        if count == 0:
            level = 0
        elif count <= 1:
            level = 1
        elif count <= 3:
            level = 2
        elif count <= 6:
            level = 3
        else:
            level = 4
        cells.append({"date": cursor.isoformat(), "level": level, "count": count})
        cursor += timedelta(days=1)
    return jsonify({"cells": cells, "weeks": weeks, "start": grid_start.isoformat()})


@bp.route("/sparkline-data", methods=["GET"])
def sparkline_data():
    today = date.today()
    snapshot = net_worth_snapshot()
    total = snapshot["net_worth"]
    cash_now = snapshot["cash"]
    cash_ratio = (cash_now / total) if total > 0 else 0.5

    # Single query: net signed flow per (date, type) for the last 7 days
    # is more work in SQL but only one round-trip; the previous version
    # ran 7 separate SUM() queries.
    week_start = today - timedelta(days=6)
    flows = (
        db.session.query(
            FinancialTransaction.date,
            FinancialTransaction.type,
            func.sum(FinancialTransaction.amount),
        )
        .filter(FinancialTransaction.date >= week_start)
        .group_by(FinancialTransaction.date, FinancialTransaction.type)
        .all()
    )
    # Build a date -> signed_net dict.
    net_by_day: dict[date, float] = {}
    for d, t, amt in flows:
        signed = float(amt) if t == "income" else -float(amt)
        net_by_day[d] = net_by_day.get(d, 0.0) + signed

    # Cumulative net that "happened after" each day in the week, including
    # today: rebase on today's net_worth and walk backwards.
    today_idx = (today - week_start).days
    days: list[dict] = []
    future_cum = 0.0
    for offset in range(today_idx + 1, -1, -1):
        d = week_start + timedelta(days=offset)
        future_cum += net_by_day.get(d, 0.0)
        nw = max(total - future_cum, 0)
        cash_d = max(nw * cash_ratio, 0)
        days.append(
            {
                "date": d.isoformat(),
                "net_worth": round(nw, 0),
                "cash": round(cash_d, 0),
                "investments": round(max(nw - cash_d, 0), 0),
            }
        )
    if days:
        days[-1]["net_worth"] = round(total, 0)
        days[-1]["cash"] = round(cash_now, 0)
        days[-1]["investments"] = round(snapshot["investments"], 0)
    return jsonify({"days": days})
