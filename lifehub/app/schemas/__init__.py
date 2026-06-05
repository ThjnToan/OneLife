"""Marshmallow schemas for request validation."""

from __future__ import annotations

from marshmallow import EXCLUDE, Schema, fields, validate


class _TolerantSchema(Schema):
    """Schema that silently drops unknown keys (forward-compat for the
    Health Connect app to add new sections without breaking older servers).
    Per-item range/type checks belong in the section handlers so the
    server can skip bad rows and accept the rest.
    """

    class Meta:
        unknown = EXCLUDE


class HealthEntrySchema(Schema):
    date = fields.Date(required=True)
    weight = fields.Float(validate=validate.Range(min=20, max=400), allow_none=True)
    steps = fields.Integer(validate=validate.Range(min=0), allow_none=True)
    workout_minutes = fields.Integer(validate=validate.Range(min=0), allow_none=True)
    mood = fields.String(
        validate=validate.OneOf(["great", "good", "okay", "bad", "terrible"]), allow_none=True
    )
    sleep_hours = fields.Float(validate=validate.Range(min=0, max=24), allow_none=True)
    water_liters = fields.Float(validate=validate.Range(min=0, max=10), allow_none=True)
    calories_in = fields.Integer(validate=validate.Range(min=0), allow_none=True)
    calories_out = fields.Integer(validate=validate.Range(min=0), allow_none=True)
    distance_km = fields.Float(validate=validate.Range(min=0), allow_none=True)
    step_calorie = fields.Integer(validate=validate.Range(min=0), allow_none=True)
    notes = fields.String(allow_none=True)


class FinancialTransactionSchema(Schema):
    date = fields.Date(allow_none=True)
    amount = fields.Float(required=True, validate=validate.Range(min=0.01))
    type = fields.String(required=True, validate=validate.OneOf(["income", "expense"]))
    category = fields.String(required=True, validate=validate.Length(min=1, max=50))
    description = fields.String(allow_none=True, validate=validate.Length(max=200))
    payment_method = fields.String(allow_none=True, validate=validate.Length(max=50))
    asset_id = fields.Integer(allow_none=True)


class BudgetCategorySchema(Schema):
    name = fields.String(required=True, validate=validate.Length(min=1, max=50))
    budget_limit = fields.Float(validate=validate.Range(min=0), allow_none=True)
    color = fields.String(validate=validate.Regexp(r"^#[0-9a-fA-F]{6}$"), allow_none=True)


class TaskSchema(Schema):
    title = fields.String(required=True, validate=validate.Length(min=1, max=200))
    description = fields.String(allow_none=True)
    category = fields.String(validate=validate.Length(max=50), allow_none=True)
    priority = fields.String(
        validate=validate.OneOf(["low", "medium", "high", "urgent"]), allow_none=True
    )
    due_date = fields.Date(allow_none=True)
    status = fields.String(
        validate=validate.OneOf(["pending", "in_progress", "completed", "cancelled"]),
        allow_none=True,
    )
    is_habit = fields.Boolean(allow_none=True)
    habit_frequency = fields.String(
        validate=validate.OneOf(["daily", "weekly", "monthly"]), allow_none=True
    )
    streak = fields.Integer(validate=validate.Range(min=0), allow_none=True)


class AssetSchema(Schema):
    name = fields.String(required=True, validate=validate.Length(min=1, max=200))
    asset_type = fields.String(required=True, validate=validate.Length(min=1, max=50))
    current_value = fields.Float(required=True, validate=validate.Range(min=0))
    cost_basis = fields.Float(validate=validate.Range(min=0), allow_none=True)
    quantity = fields.Float(validate=validate.Range(min=0), allow_none=True)
    unit = fields.String(validate=validate.Length(max=50), allow_none=True)
    broker_platform = fields.String(validate=validate.Length(max=100), allow_none=True)
    notes = fields.String(allow_none=True)


class GoalSchema(Schema):
    title = fields.String(required=True, validate=validate.Length(min=1, max=200))
    description = fields.String(allow_none=True)
    category = fields.String(validate=validate.Length(max=50), allow_none=True)
    status = fields.String(
        validate=validate.OneOf(["active", "completed", "archived", "on_hold"]), allow_none=True
    )
    progress = fields.Integer(validate=validate.Range(min=0, max=100), allow_none=True)
    target_date = fields.Date(allow_none=True)


class JournalEntrySchema(Schema):
    date = fields.Date(required=True)
    title = fields.String(validate=validate.Length(max=200), allow_none=True)
    content = fields.String(required=True)
    mood = fields.String(validate=validate.Length(max=20), allow_none=True)
    tags = fields.String(validate=validate.Length(max=200), allow_none=True)
    is_favorite = fields.Boolean(allow_none=True)


class LearningItemSchema(Schema):
    title = fields.String(required=True, validate=validate.Length(min=1, max=200))
    item_type = fields.String(
        required=True,
        validate=validate.OneOf(["book", "course", "article", "video", "podcast", "other"]),
    )
    status = fields.String(
        validate=validate.OneOf(["not_started", "in_progress", "completed", "paused"]),
        allow_none=True,
    )
    progress = fields.Integer(validate=validate.Range(min=0, max=100), allow_none=True)
    author = fields.String(validate=validate.Length(max=100), allow_none=True)
    url = fields.Url(allow_none=True)
    notes = fields.String(allow_none=True)
    rating = fields.Integer(validate=validate.Range(min=1, max=5), allow_none=True)
    start_date = fields.Date(allow_none=True)
    end_date = fields.Date(allow_none=True)
    category = fields.String(validate=validate.Length(max=50), allow_none=True)


class CalendarEventSchema(Schema):
    title = fields.String(required=True, validate=validate.Length(min=1, max=200))
    description = fields.String(allow_none=True)
    start_time = fields.DateTime(required=True)
    end_time = fields.DateTime(allow_none=True)
    location = fields.String(validate=validate.Length(max=200), allow_none=True)
    category = fields.String(validate=validate.Length(max=50), allow_none=True)
    is_all_day = fields.Boolean(allow_none=True)
    reminder = fields.Boolean(allow_none=True)


class ContactSchema(Schema):
    name = fields.String(required=True, validate=validate.Length(min=1, max=100))
    email = fields.Email(allow_none=True)
    phone = fields.String(validate=validate.Length(max=50), allow_none=True)
    address = fields.String(allow_none=True)
    birthday = fields.Date(allow_none=True)
    company = fields.String(validate=validate.Length(max=100), allow_none=True)
    job_title = fields.String(validate=validate.Length(max=100), allow_none=True)
    category = fields.String(validate=validate.Length(max=50), allow_none=True)
    notes = fields.String(allow_none=True)


class FolderSchema(Schema):
    name = fields.String(required=True, validate=validate.Length(min=1, max=100))
    parent_id = fields.Integer(allow_none=True)


class DocumentSchema(Schema):
    filename = fields.String(required=True, validate=validate.Length(min=1, max=200))
    original_name = fields.String(required=True, validate=validate.Length(min=1, max=200))
    file_type = fields.String(validate=validate.Length(max=50), allow_none=True)
    file_size = fields.Integer(validate=validate.Range(min=0), allow_none=True)
    description = fields.String(allow_none=True)
    category = fields.String(validate=validate.Length(max=50), allow_none=True)
    tags = fields.String(validate=validate.Length(max=200), allow_none=True)
    folder_id = fields.Integer(allow_none=True)


# Ingest schemas (for Health Connect Android app)
class IngestStepSchema(_TolerantSchema):
    start = fields.String(required=True)
    end = fields.String(required=True)
    count = fields.Integer(required=True)


class IngestHeartRateSchema(_TolerantSchema):
    timestamp = fields.String(required=True)
    bpm = fields.Float(required=True)


class IngestSleepSchema(_TolerantSchema):
    start = fields.String(required=True)
    end = fields.String(required=True)
    stages = fields.List(fields.Dict(), allow_none=True)


class IngestWeightSchema(_TolerantSchema):
    timestamp = fields.String(required=True)
    kg = fields.Float(required=True)


class IngestHydrationSchema(_TolerantSchema):
    timestamp = fields.String(required=True)
    liters = fields.Float(required=True)


class IngestExerciseSchema(_TolerantSchema):
    start = fields.String(required=True)
    end = fields.String(required=True)
    type = fields.String(allow_none=True)
    calories = fields.Float(allow_none=True)
    distance_m = fields.Float(allow_none=True)


class IngestCaloriesOutSchema(_TolerantSchema):
    start = fields.String(required=True)
    kcal = fields.Float(required=True)


class IngestNutritionSchema(_TolerantSchema):
    start = fields.String(required=True)
    kcal = fields.Float(required=True)
    meal = fields.String(allow_none=True)


class IngestPayloadSchema(_TolerantSchema):
    tz_offset_minutes = fields.Integer(allow_none=True)
    steps = fields.List(fields.Nested(IngestStepSchema), allow_none=True)
    heart_rate = fields.List(fields.Nested(IngestHeartRateSchema), allow_none=True)
    sleep = fields.List(fields.Nested(IngestSleepSchema), allow_none=True)
    weight = fields.List(fields.Nested(IngestWeightSchema), allow_none=True)
    hydration = fields.List(fields.Nested(IngestHydrationSchema), allow_none=True)
    exercise = fields.List(fields.Nested(IngestExerciseSchema), allow_none=True)
    calories_out = fields.List(fields.Nested(IngestCaloriesOutSchema), allow_none=True)
    nutrition = fields.List(fields.Nested(IngestNutritionSchema), allow_none=True)
