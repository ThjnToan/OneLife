"""Net-worth computation.

The historical view is an approximation derived from the current snapshot
plus the cumulative cashflow. For exact history, populate the optional
``NetWorthSnapshot`` table daily; for now we expose a snapshot helper.
"""

from __future__ import annotations

from datetime import date
from typing import TypedDict

from sqlalchemy import case, func

from ..extensions import db
from ..models import Asset, FinancialTransaction

CASH_TYPES = ("cash", "savings")
INVESTMENT_TYPES = (
    "stock",
    "crypto",
    "real_estate",
    "vehicle",
    "gold",
    "certificate",
    "bond",
    "other",
)


class NetWorthSnapshot(TypedDict):
    cash: float
    investments: float
    net_worth: float


def net_worth_snapshot() -> NetWorthSnapshot:
    """Compute the current net worth from the assets table."""
    cash = (
        db.session.query(func.sum(Asset.current_value))
        .filter(Asset.asset_type.in_(CASH_TYPES))
        .scalar()
        or 0
    )
    investments = (
        db.session.query(func.sum(Asset.current_value))
        .filter(Asset.asset_type.in_(INVESTMENT_TYPES))
        .scalar()
        or 0
    )
    return NetWorthSnapshot(
        cash=float(cash),
        investments=float(investments),
        net_worth=float(cash) + float(investments),
    )


def cashflow_through(day: date) -> float:
    """Sum of (income - expense) up to and including ``day``."""
    flow = (
        db.session.query(
            func.sum(
                case(
                    (FinancialTransaction.type == "income", FinancialTransaction.amount),
                    else_=-FinancialTransaction.amount,
                )
            )
        )
        .filter(FinancialTransaction.date <= day)
        .scalar()
        or 0
    )
    return float(flow)


def estimated_history(months: int = 12) -> list[dict]:
    """Best-effort net-worth history.

    The current value is exact; earlier months are inferred by walking the
    cashflow backwards. Treat these numbers as estimates; the project should
    grow a proper snapshot table for real history.
    """
    from calendar import monthrange

    today = date.today()
    current = net_worth_snapshot()
    total = current["net_worth"]
    cash_now = current["cash"]

    out: list[dict] = []
    for i in range(months - 1, -1, -1):
        year = today.year
        month = today.month - i
        while month < 1:
            month += 12
            year -= 1
        _, last_day = monthrange(year, month)
        month_end = today.replace(year=year, month=month, day=min(last_day, today.day))
        if month_end > today:
            month_end = today

        cashflow_to_date = cashflow_through(month_end)
        nw = max(total - (total - cashflow_to_date), 0)
        cash_ratio = (cash_now / total) if total > 0 else 0.5
        cash_d = max(nw * cash_ratio, 0)

        out.append(
            {
                "month": f"{year}-{month:02d}",
                "date": month_end.isoformat(),
                "net_worth": round(nw, 0),
                "cash": round(cash_d, 0),
                "investments": round(max(nw - cash_d, 0), 0),
            }
        )

    if out:
        out[-1]["net_worth"] = round(total, 0)
        out[-1]["cash"] = round(cash_now, 0)
        out[-1]["investments"] = round(current["investments"], 0)
    return out
