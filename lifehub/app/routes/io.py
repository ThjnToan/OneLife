"""JSON export and import (backup/restore)."""

from __future__ import annotations

from flask import Blueprint, jsonify

from ..extensions import db
from ..models import (
    Asset,
    BudgetCategory,
    CalendarEvent,
    Contact,
    Document,
    FinancialTransaction,
    Folder,
    Goal,
    HealthEntry,
    HeartRateSample,
    JournalEntry,
    LearningItem,
    SleepSession,
    Task,
    UserSetting,
)
from ..utils import get_json_data, to_date, to_datetime, try_commit, utcnow

bp = Blueprint("io", __name__, url_prefix="/api")

EXPORT_TABLES = [
    ("assets", Asset),
    ("tasks", Task),
    ("health_entries", HealthEntry),
    ("heart_rate_samples", HeartRateSample),
    ("sleep_sessions", SleepSession),
    ("transactions", FinancialTransaction),
    ("budget_categories", BudgetCategory),
    ("learning_items", LearningItem),
    ("events", CalendarEvent),
    ("contacts", Contact),
    ("folders", Folder),
    ("document_metadata", Document),
    ("journal_entries", JournalEntry),
    ("goals", Goal),
    ("user_settings", UserSetting),
]

EXPORT_SCHEMA_VERSION = 3


# Fields on each model that should be parsed as a date (not datetime) on import.
_IMPORT_DATE_FIELDS: dict[type, list[str]] = {
    Task: ["due_date"],
    HealthEntry: ["date"],
    FinancialTransaction: ["date"],
    LearningItem: ["start_date", "end_date"],
    Contact: ["birthday"],
    JournalEntry: ["date"],
    Goal: ["target_date"],
}

# Fields on each model that should be parsed as a datetime on import.
_IMPORT_DATETIME_FIELDS: dict[type, list[str]] = {
    CalendarEvent: ["start_time", "end_time"],
    HeartRateSample: ["timestamp"],
    SleepSession: ["start_time", "end_time"],
}

# Fields that are auto-populated by SQLAlchemy/the app and must not be
# re-applied on import. ``id`` is the integer primary key (let the DB
# assign). Timestamp fields have server/defaults and recreating them
# would confuse delta sync and dedup logic.
_IMPORT_SKIP_FIELDS: dict[type, set[str]] = {
    Task: {"id", "created_at", "completed_at", "last_completed_on"},
    HealthEntry: {"id", "created_at"},
    HeartRateSample: {"id", "created_at"},
    SleepSession: {"id", "created_at"},
    FinancialTransaction: {"id", "created_at"},
    BudgetCategory: {"id", "created_at"},
    LearningItem: {"id", "created_at"},
    CalendarEvent: {"id", "created_at"},
    Contact: {"id", "created_at"},
    Folder: {"id", "created_at"},
    Document: {"id", "upload_date"},
    JournalEntry: {"id", "created_at", "updated_at"},
    Goal: {"id", "created_at", "completed_at"},
    Asset: {"id", "created_at", "updated_at"},
    UserSetting: {"updated_at"},
}


def _model_fields(model: type) -> set[str]:
    """Return the set of column names for a SQLAlchemy model.

    Cached per-class so the import of a large payload doesn't pay the
    introspection cost for every row.
    """
    cache_attr = "_io_import_fields"
    cached = getattr(model, cache_attr, None)
    if cached is None:
        # All models in EXPORT_TABLES are SQLAlchemy declarative models,
        # so they always have ``__table__``. The ignore is for mypy on
        # dynamic ``type[object]`` parameters.
        cached = set(model.__table__.columns.keys())  # type: ignore[attr-defined]
        setattr(model, cache_attr, cached)
    return cached


def _clean_row(item: dict, model: type) -> dict:
    """Drop fields the model can't accept on import.

    Always drops ``id`` (let the DB assign), auto-populated timestamps,
    and any computed/derived fields in ``to_dict()`` (e.g. ``gain_loss``).
    New top-level keys added to the export schema are silently skipped,
    so old clients can still import new exports.
    """
    allowed = _model_fields(model)
    skip = _IMPORT_SKIP_FIELDS.get(model, set())
    return {k: v for k, v in item.items() if k in allowed and k not in skip}


# Date-time fields that the export serializes as ISO strings and the
# DB column is DateTime (so we have to parse on the way in).
_IMPORT_AUTO_DATETIME_FIELDS: dict[type, set[str]] = {
    Task: {"created_at", "completed_at", "last_completed_on"},
    HealthEntry: {"created_at"},
    HeartRateSample: {"created_at"},
    SleepSession: {"created_at"},
    FinancialTransaction: {"created_at"},
    BudgetCategory: {"created_at"},
    LearningItem: {"created_at"},
    CalendarEvent: {"created_at"},
    Contact: {"created_at"},
    Folder: {"created_at"},
    JournalEntry: {"created_at", "updated_at"},
    Goal: {"created_at", "completed_at"},
    Asset: {"created_at", "updated_at"},
    UserSetting: {"updated_at"},
}


def _coerce_dates(item: dict, model: type) -> None:
    for f in _IMPORT_DATE_FIELDS.get(model, []):
        if f in item and item[f] is not None:
            item[f] = to_date(item[f])
    for f in _IMPORT_DATETIME_FIELDS.get(model, []):
        if f in item and item[f] is not None:
            item[f] = to_datetime(item[f])
    for f in _IMPORT_AUTO_DATETIME_FIELDS.get(model, set()):
        if f in item and isinstance(item[f], str) and item[f]:
            item[f] = to_datetime(item[f])


@bp.route("/export", methods=["GET"])
def export_data():
    payload: dict = {
        "exported_at": utcnow().isoformat(),
        "schema_version": EXPORT_SCHEMA_VERSION,
    }
    for key, model in EXPORT_TABLES:
        payload[key] = [m.to_dict() for m in model.query.all()]  # type: ignore[attr-defined]
    return jsonify(payload)


@bp.route("/import", methods=["POST"])
def import_data():
    """Validate-then-swap import.

    The previous implementation deleted every row in every table first
    and only then tried to insert the new data; a malformed payload
    could wipe live data. We now build all model instances in memory,
    flush once to surface validation/constraint errors, and only after
    that commit the destructive delete+reinsert. A failure at any point
    rolls back the whole transaction.
    """
    data = get_json_data()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    if not isinstance(data, dict):
        return jsonify({"error": "Body must be a JSON object"}), 400

    prepared: list = []
    counts: dict[str, int] = {}

    for key, model in EXPORT_TABLES:
        items = data.get(key) or []
        if not isinstance(items, list):
            return jsonify({"error": f"{key!r} must be a list"}), 400
        for item in items:
            if not isinstance(item, dict):
                return jsonify({"error": f"{key!r} entries must be objects"}), 400
            _coerce_dates(item, model)
            clean = _clean_row(item, model)
            try:
                prepared.append(model(**clean))
            except TypeError as exc:
                return (
                    jsonify({"error": f"{key}: invalid row ({exc})"}),
                    400,
                )
        counts[key] = len(items)

    # Flush first so any DB-level constraint error is raised before
    # we destroy the existing data.
    try:
        for obj in prepared:
            db.session.add(obj)
        db.session.flush()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Import validation failed: {exc}"}), 400

    for _, model in EXPORT_TABLES:
        db.session.query(model).delete()  # type: ignore[arg-type]

    err, code = try_commit(db.session)
    if err is not None:
        return err, code
    return jsonify({"message": "Imported", "counts": counts, "total": len(prepared)})
