"""SQLAlchemy models for OneLife."""

from __future__ import annotations

from sqlalchemy import Index, UniqueConstraint

from .extensions import db
from .utils import utcnow


class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    category = db.Column(db.String(50), default="general")
    priority = db.Column(db.String(20), default="medium")
    due_date = db.Column(db.Date)
    status = db.Column(db.String(20), default="pending")
    is_habit = db.Column(db.Boolean, default=False)
    habit_frequency = db.Column(db.String(20), default="daily")
    streak = db.Column(db.Integer, default=0)
    last_completed_on = db.Column(db.Date)  # used for consecutive-day streak
    created_at = db.Column(db.DateTime, default=utcnow)
    completed_at = db.Column(db.DateTime)

    __table_args__ = (
        Index("ix_tasks_status", "status"),
        Index("ix_tasks_due_date", "due_date"),
        Index("ix_tasks_is_habit", "is_habit"),
        Index("ix_tasks_category", "category"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "category": self.category,
            "priority": self.priority,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "status": self.status,
            "is_habit": self.is_habit,
            "habit_frequency": self.habit_frequency,
            "streak": self.streak,
            "last_completed_on": (
                self.last_completed_on.isoformat() if self.last_completed_on else None
            ),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class HealthEntry(db.Model):
    __tablename__ = "health_entries"

    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, default=utcnow)
    weight = db.Column(db.Float)
    steps = db.Column(db.Integer)
    workout_minutes = db.Column(db.Integer)
    mood = db.Column(db.String(20))
    sleep_hours = db.Column(db.Float)
    water_liters = db.Column(db.Float)
    calories_in = db.Column(db.Integer)
    calories_out = db.Column(db.Integer)
    distance_km = db.Column(db.Float)
    step_calorie = db.Column(db.Integer)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (Index("ix_health_date", "date"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "date": self.date.isoformat() if self.date else None,
            "weight": self.weight,
            "steps": self.steps,
            "workout_minutes": self.workout_minutes,
            "mood": self.mood,
            "sleep_hours": self.sleep_hours,
            "water_liters": self.water_liters,
            "calories_in": self.calories_in,
            "calories_out": self.calories_out,
            "distance_km": self.distance_km,
            "step_calorie": self.step_calorie,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class HeartRateSample(db.Model):
    """One heart-rate reading. Many rows per day.

    Populated from Samsung Health CSV export and from the Health Connect
    Android companion app. Source identifies the origin (samsung_csv,
    health_connect, manual).
    """

    __tablename__ = "heart_rate_samples"

    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, nullable=False)
    bpm = db.Column(db.Integer, nullable=False)
    source = db.Column(db.String(50))
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (
        Index("ix_hr_timestamp", "timestamp"),
        Index("ix_hr_source_timestamp", "source", "timestamp"),
        UniqueConstraint(
            "source", "timestamp", "bpm", name="uq_hr_source_timestamp_bpm"
        ),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "bpm": self.bpm,
            "source": self.source,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class SleepSession(db.Model):
    """One sleep period. ``stages_json`` is a list of
    ``{"stage": "awake|light|deep|rem", "start": ..., "end": ...}``.

    Sleep duration is also folded into HealthEntry.sleep_hours for the
    daily aggregate view.
    """

    __tablename__ = "sleep_sessions"

    id = db.Column(db.Integer, primary_key=True)
    start_time = db.Column(db.DateTime, nullable=False)
    end_time = db.Column(db.DateTime, nullable=False)
    duration_minutes = db.Column(db.Integer, nullable=False)
    stages_json = db.Column(db.Text)
    source = db.Column(db.String(50))
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (
        Index("ix_sleep_start", "start_time"),
        Index("ix_sleep_source_start", "source", "start_time"),
        UniqueConstraint(
            "source", "start_time", "end_time", name="uq_sleep_source_start_end"
        ),
    )

    def to_dict(self) -> dict:
        import json

        stages = None
        if self.stages_json:
            try:
                stages = json.loads(self.stages_json)
            except (TypeError, ValueError):
                stages = None
        return {
            "id": self.id,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "duration_minutes": self.duration_minutes,
            "stages": stages,
            "source": self.source,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class FinancialTransaction(db.Model):
    __tablename__ = "financial_transactions"

    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, default=utcnow)
    amount = db.Column(db.Float, nullable=False)
    type = db.Column(db.String(20), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    description = db.Column(db.String(200))
    payment_method = db.Column(db.String(50))
    asset_id = db.Column(
        db.Integer,
        db.ForeignKey("assets.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = db.Column(db.DateTime, default=utcnow)

    asset = db.relationship("Asset", backref="transactions")

    __table_args__ = (
        Index("ix_tx_date", "date"),
        Index("ix_tx_type_date", "type", "date"),
        Index("ix_tx_category", "category"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "date": self.date.isoformat() if self.date else None,
            "amount": self.amount,
            "type": self.type,
            "category": self.category,
            "description": self.description,
            "payment_method": self.payment_method,
            "asset_id": self.asset_id,
            "asset_name": self.asset.name if self.asset else None,
            "asset_type": self.asset.asset_type if self.asset else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class BudgetCategory(db.Model):
    __tablename__ = "budget_categories"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True)
    budget_limit = db.Column(db.Float, default=0)
    color = db.Column(db.String(7), default="#3b82f6")
    created_at = db.Column(db.DateTime, default=utcnow)

    def to_dict(self) -> dict:
        from sqlalchemy import func

        spent = (
            db.session.query(func.sum(FinancialTransaction.amount))
            .filter(
                FinancialTransaction.category == self.name,
                FinancialTransaction.type == "expense",
            )
            .scalar()
            or 0
        )
        spent_f = float(spent)
        return {
            "id": self.id,
            "name": self.name,
            "budget_limit": self.budget_limit,
            "spent": spent_f,
            "remaining": (self.budget_limit or 0) - spent_f,
            "color": self.color,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class LearningItem(db.Model):
    __tablename__ = "learning_items"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    item_type = db.Column(db.String(20), nullable=False)
    status = db.Column(db.String(20), default="not_started")
    progress = db.Column(db.Integer, default=0)
    author = db.Column(db.String(100))
    url = db.Column(db.String(500))
    notes = db.Column(db.Text)
    rating = db.Column(db.Integer)
    start_date = db.Column(db.Date)
    end_date = db.Column(db.Date)
    category = db.Column(db.String(50))
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (
        Index("ix_learning_status", "status"),
        Index("ix_learning_type", "item_type"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "item_type": self.item_type,
            "status": self.status,
            "progress": self.progress,
            "author": self.author,
            "url": self.url,
            "notes": self.notes,
            "rating": self.rating,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "category": self.category,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class CalendarEvent(db.Model):
    __tablename__ = "calendar_events"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    start_time = db.Column(db.DateTime, nullable=False)
    end_time = db.Column(db.DateTime)
    location = db.Column(db.String(200))
    category = db.Column(db.String(50))
    is_all_day = db.Column(db.Boolean, default=False)
    reminder = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (Index("ix_event_start_time", "start_time"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "location": self.location,
            "category": self.category,
            "is_all_day": self.is_all_day,
            "reminder": self.reminder,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Contact(db.Model):
    __tablename__ = "contacts"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100))
    phone = db.Column(db.String(50))
    address = db.Column(db.Text)
    birthday = db.Column(db.Date)
    company = db.Column(db.String(100))
    job_title = db.Column(db.String(100))
    category = db.Column(db.String(50))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (
        Index("ix_contact_name", "name"),
        Index("ix_contact_category", "category"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "phone": self.phone,
            "address": self.address,
            "birthday": self.birthday.isoformat() if self.birthday else None,
            "company": self.company,
            "job_title": self.job_title,
            "category": self.category,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Folder(db.Model):
    __tablename__ = "folders"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    parent_id = db.Column(
        db.Integer,
        db.ForeignKey("folders.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_at = db.Column(db.DateTime, default=utcnow)

    parent = db.relationship(
        "Folder",
        remote_side=[id],
        backref="children",
        lazy="joined",
    )

    def to_dict(self, include_path: bool = False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "parent_id": self.parent_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_path:
            data["path"] = self.get_path()
        return data

    def get_path(self) -> list[dict]:
        path: list[dict] = []
        current = self
        seen: set[int] = set()
        while current and current.id not in seen:
            seen.add(current.id)
            path.append({"id": current.id, "name": current.name})
            current = current.parent
        return list(reversed(path))


class Document(db.Model):
    __tablename__ = "documents"

    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(200), nullable=False)
    original_name = db.Column(db.String(200), nullable=False)
    file_type = db.Column(db.String(50))
    file_size = db.Column(db.Integer)
    upload_date = db.Column(db.DateTime, default=utcnow)
    description = db.Column(db.Text)
    category = db.Column(db.String(50))
    tags = db.Column(db.String(200))
    folder_id = db.Column(
        db.Integer,
        db.ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
    )

    folder = db.relationship("Folder", backref="documents")

    __table_args__ = (Index("ix_doc_folder_id", "folder_id"),)

    def to_dict(self, include_path: bool = False) -> dict:
        data = {
            "id": self.id,
            "filename": self.filename,
            "original_name": self.original_name,
            "file_type": self.file_type,
            "file_size": self.file_size,
            "upload_date": self.upload_date.isoformat() if self.upload_date else None,
            "description": self.description,
            "category": self.category,
            "tags": self.tags,
            "folder_id": self.folder_id,
            "folder_name": self.folder.name if self.folder else None,
        }
        if include_path and self.folder:
            data["path"] = self.folder.get_path()
        return data


class JournalEntry(db.Model):
    __tablename__ = "journal_entries"

    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, default=utcnow)
    title = db.Column(db.String(200))
    content = db.Column(db.Text, nullable=False)
    mood = db.Column(db.String(20))
    tags = db.Column(db.String(200))
    is_favorite = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(
        db.DateTime,
        default=utcnow,
        onupdate=utcnow,
    )

    __table_args__ = (Index("ix_journal_date", "date"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "date": self.date.isoformat() if self.date else None,
            "title": self.title,
            "content": self.content,
            "mood": self.mood,
            "tags": self.tags,
            "is_favorite": self.is_favorite,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Goal(db.Model):
    __tablename__ = "goals"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    category = db.Column(db.String(50))
    status = db.Column(db.String(20), default="active")
    progress = db.Column(db.Integer, default=0)
    target_date = db.Column(db.Date)
    created_at = db.Column(db.DateTime, default=utcnow)
    completed_at = db.Column(db.DateTime)

    __table_args__ = (Index("ix_goal_status", "status"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "category": self.category,
            "status": self.status,
            "progress": self.progress,
            "target_date": self.target_date.isoformat() if self.target_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class Asset(db.Model):
    __tablename__ = "assets"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    asset_type = db.Column(db.String(50), nullable=False)
    current_value = db.Column(db.Float, nullable=False, default=0)
    cost_basis = db.Column(db.Float, default=0)
    quantity = db.Column(db.Float, default=1)
    unit = db.Column(db.String(50))
    broker_platform = db.Column(db.String(100))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(
        db.DateTime,
        default=utcnow,
        onupdate=utcnow,
    )

    __table_args__ = (Index("ix_asset_type", "asset_type"),)

    def to_dict(self, include_valuation_history: bool = False, history_days: int = 90) -> dict:
        gain_loss = (self.current_value or 0) - (self.cost_basis or 0)
        cost = self.cost_basis or 0
        gain_loss_percent = (gain_loss / cost * 100) if cost > 0 else 0
        out: dict = {
            "id": self.id,
            "name": self.name,
            "asset_type": self.asset_type,
            "current_value": self.current_value,
            "cost_basis": self.cost_basis,
            "quantity": self.quantity,
            "unit": self.unit,
            "broker_platform": self.broker_platform,
            "notes": self.notes,
            "gain_loss": gain_loss,
            "gain_loss_percent": round(gain_loss_percent, 2),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_valuation_history:
            out["valuations"] = [
                v.to_dict()
                for v in AssetValuation.history_for_asset(self.id, days=history_days)
            ]
        return out


class AssetValuation(db.Model):
    """Daily snapshot of an asset's value.

    One row per ``(asset_id, date)``; the latest value wins for any
    given day. Lets the user track how an investment changes over time
    without polluting the ``Asset`` row, which still carries the most
    recent value for fast net-worth calculations.
    """

    __tablename__ = "asset_valuations"

    id = db.Column(db.Integer, primary_key=True)
    asset_id = db.Column(db.Integer, db.ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    date = db.Column(db.Date, nullable=False)
    value = db.Column(db.Float, nullable=False)
    recorded_at = db.Column(db.DateTime, default=utcnow)

    asset = db.relationship("Asset", backref=db.backref("valuations", cascade="all, delete-orphan"))

    __table_args__ = (
        UniqueConstraint("asset_id", "date", name="uq_asset_valuation_asset_date"),
        Index("ix_asset_valuation_asset_date", "asset_id", "date"),
    )

    def to_dict(self) -> dict:
        return {"date": self.date.isoformat(), "value": self.value}

    @classmethod
    def history_for_asset(cls, asset_id: int, days: int | None = None):
        """Return valuations for ``asset_id`` ordered oldest-first.

        With ``days`` set, only the last N days are returned; the
        boundary is inclusive (so ``days=30`` returns the most recent
        30 calendar days, not "since 30 days ago" exactly).
        """
        from datetime import date, timedelta

        q = cls.query.filter(cls.asset_id == asset_id)
        if days is not None:
            cutoff = date.today() - timedelta(days=days - 1)
            q = q.filter(cls.date >= cutoff)
        return q.order_by(cls.date.asc()).all()


class UserSetting(db.Model):
    """Key/value store for user preferences.

    Each setting is one row keyed by ``key``. ``value`` is stored as text
    (numbers and booleans are stringified on write, parsed on read). The
    service layer in ``app.services.settings`` is responsible for
    validation, defaulting, and type coercion.
    """

    __tablename__ = "user_settings"

    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.Text, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=utcnow,
        onupdate=utcnow,
    )

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "value": self.value,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
