"""User settings — typed key/value store backed by the ``user_settings`` table.

A registry declares every known setting: its type, default value, allowed
choices or numeric range, and human-readable label/help text. The
``get``/``set`` helpers validate against the registry, coerce strings
into the declared type, and reject unknown keys.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from ..extensions import db
from ..models import UserSetting


@dataclass(frozen=True)
class SettingSpec:
    """Schema for a single user setting."""

    key: str
    type: str  # "string" | "int" | "float" | "bool" | "choice"
    default: Any
    label: str
    group: str
    help: str = ""
    choices: tuple[tuple[str, str], ...] = ()  # (value, label) for "choice"
    min: float | None = None
    max: float | None = None
    pattern: str | None = None
    sensitive: bool = False  # redact in API responses (e.g. server URL hint)

    def coerce(self, raw: Any) -> Any:
        if raw is None:
            return self.default
        if self.type == "bool":
            if isinstance(raw, bool):
                return raw
            s = str(raw).strip().lower()
            if s in ("1", "true", "yes", "on"):
                return True
            if s in ("0", "false", "no", "off", ""):
                return False
            raise ValueError(f"{self.key}: expected boolean, got {raw!r}")
        if self.type == "int":
            try:
                v = int(str(raw).strip())
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{self.key}: expected integer, got {raw!r}") from exc
            if self.min is not None and v < self.min:
                raise ValueError(f"{self.key}: must be >= {self.min}")
            if self.max is not None and v > self.max:
                raise ValueError(f"{self.key}: must be <= {self.max}")
            return v
        if self.type == "float":
            try:
                v = float(str(raw).strip())
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{self.key}: expected number, got {raw!r}") from exc
            if self.min is not None and v < self.min:
                raise ValueError(f"{self.key}: must be >= {self.min}")
            if self.max is not None and v > self.max:
                raise ValueError(f"{self.key}: must be <= {self.max}")
            return v
        if self.type == "choice":
            s = str(raw).strip()
            valid = {v for v, _ in self.choices}
            if s not in valid:
                raise ValueError(f"{self.key}: must be one of {sorted(valid)}, got {raw!r}")
            return s
        # string
        s = str(raw)
        if self.min is not None and len(s) < self.min:
            raise ValueError(f"{self.key}: too short (min {self.min:.0f} chars)")
        if self.max is not None and len(s) > self.max:
            raise ValueError(f"{self.key}: too long (max {self.max:.0f} chars)")
        return s

    def to_dict(self, value: Any) -> dict:
        out = {
            "key": self.key,
            "value": value,
            "default": self.default,
            "type": self.type,
            "label": self.label,
            "group": self.group,
            "help": self.help,
        }
        if self.choices:
            out["choices"] = [{"value": v, "label": lab} for v, lab in self.choices]
        if self.min is not None:
            out["min"] = self.min
        if self.max is not None:
            out["max"] = self.max
        return out


# ==================== REGISTRY ====================

REGISTRY: dict[str, SettingSpec] = {
    # ---- Display ----
    "theme": SettingSpec(
        key="theme",
        type="choice",
        default="auto",
        label="Theme",
        group="display",
        help="Color theme. Auto follows your system preference.",
        choices=(("auto", "Auto"), ("light", "Light"), ("dark", "Dark")),
    ),
    "currency_symbol": SettingSpec(
        key="currency_symbol",
        type="string",
        default="$",
        label="Currency symbol",
        group="display",
        help="Shown next to amounts (e.g. $1,234.56).",
        max=8,
    ),
    "currency_code": SettingSpec(
        key="currency_code",
        type="string",
        default="USD",
        label="Currency code",
        group="display",
        help="ISO 4217 code (USD, EUR, VND, JPY, ...). Used for future FX.",
        max=8,
    ),
    "date_format": SettingSpec(
        key="date_format",
        type="choice",
        default="YYYY-MM-DD",
        label="Date format",
        group="display",
        choices=(
            ("YYYY-MM-DD", "YYYY-MM-DD (2026-06-04)"),
            ("DD/MM/YYYY", "DD/MM/YYYY (04/06/2026)"),
            ("MM/DD/YYYY", "MM/DD/YYYY (06/04/2026)"),
        ),
    ),
    "first_day_of_week": SettingSpec(
        key="first_day_of_week",
        type="choice",
        default="0",
        label="First day of week",
        group="display",
        choices=(("0", "Sunday"), ("1", "Monday")),
    ),
    "tz_offset_minutes": SettingSpec(
        key="tz_offset_minutes",
        type="int",
        default=0,
        label="Time zone offset (minutes from UTC)",
        group="display",
        help="Used for Samsung Health import. UTC+7 = 420, UTC-5 = -300, UTC+0 = 0.",
        min=-14 * 60,
        max=14 * 60,
    ),
    # ---- Health goals ----
    "step_goal": SettingSpec(
        key="step_goal",
        type="int",
        default=10000,
        label="Daily step goal",
        group="health",
        min=0,
        max=200000,
    ),
    "water_goal_liters": SettingSpec(
        key="water_goal_liters",
        type="float",
        default=2.5,
        label="Daily water goal (liters)",
        group="health",
        min=0,
        max=20,
    ),
    "sleep_goal_hours": SettingSpec(
        key="sleep_goal_hours",
        type="float",
        default=8.0,
        label="Daily sleep goal (hours)",
        group="health",
        min=0,
        max=24,
    ),
    "workout_goal_minutes_per_week": SettingSpec(
        key="workout_goal_minutes_per_week",
        type="int",
        default=150,
        label="Weekly workout goal (minutes)",
        group="health",
        help="WHO recommends 150 min/week of moderate activity.",
        min=0,
        max=2000,
    ),
    "calorie_goal_in": SettingSpec(
        key="calorie_goal_in",
        type="int",
        default=2000,
        label="Daily calorie intake goal",
        group="health",
        min=0,
        max=20000,
    ),
    "calorie_goal_out": SettingSpec(
        key="calorie_goal_out",
        type="int",
        default=500,
        label="Daily calorie burn goal",
        group="health",
        min=0,
        max=20000,
    ),
    # ---- Privacy ----
    "hide_net_worth_on_dashboard": SettingSpec(
        key="hide_net_worth_on_dashboard",
        type="bool",
        default=False,
        label="Hide net worth on dashboard",
        group="privacy",
        help="Useful if you share your screen or use screenshots.",
    ),
}


# ==================== DB I/O ====================


def _fetch_rows() -> dict[str, str]:
    """Return raw ``{key: value}`` from the DB. Single round-trip."""
    rows = db.session.query(UserSetting.key, UserSetting.value).all()
    return dict(rows)


def get(key: str, default: Any = None) -> Any:
    """Read one setting, coerced to its declared type.

    Unknown keys return ``default`` without touching the DB.
    """
    spec = REGISTRY.get(key)
    if spec is None:
        return default
    row = db.session.get(UserSetting, key)
    if row is None:
        return spec.default
    try:
        return spec.coerce(row.value)
    except ValueError:
        return spec.default


def set_value(key: str, value: Any) -> Any:
    """Validate and persist one setting. Returns the coerced value."""
    spec = REGISTRY.get(key)
    if spec is None:
        raise ValueError(f"Unknown setting: {key!r}")
    coerced = spec.coerce(value)
    row = db.session.get(UserSetting, key)
    if row is None:
        row = UserSetting(key=key, value=str(coerced))
        db.session.add(row)
    else:
        row.value = str(coerced)
    db.session.commit()
    return coerced


def set_many(values: dict) -> tuple[dict, list[str]]:
    """Bulk update. Returns (applied, errors).

    Validation errors are accumulated; the whole transaction commits on
    success and rolls back on the first hard failure.
    """
    applied: dict = {}
    errors: list[str] = []
    for key, value in values.items():
        spec = REGISTRY.get(key)
        if spec is None:
            errors.append(f"Unknown setting: {key!r}")
            continue
        try:
            applied[key] = spec.coerce(value)
        except ValueError as exc:
            errors.append(str(exc))
    if errors:
        db.session.rollback()
        return {}, errors
    for key, coerced in applied.items():
        row = db.session.get(UserSetting, key)
        if row is None:
            db.session.add(UserSetting(key=key, value=str(coerced)))
        else:
            row.value = str(coerced)
    db.session.commit()
    return applied, []


def all_settings() -> dict:
    """Return the full registry annotated with current values, grouped."""
    raw = _fetch_rows()
    grouped: dict[str, list[dict]] = {}
    for spec in REGISTRY.values():
        if spec.key in raw:
            try:
                value = spec.coerce(raw[spec.key])
            except ValueError:
                value = spec.default
        else:
            value = spec.default
        grouped.setdefault(spec.group, []).append(spec.to_dict(value))
    return {
        "groups": [
            {"id": "display", "label": "Display & locale"},
            {"id": "health", "label": "Health goals"},
            {"id": "privacy", "label": "Privacy"},
        ],
        "settings": grouped,
    }


def reset_all() -> int:
    """Delete all stored settings. Returns the number of rows removed."""
    n = db.session.query(UserSetting).delete()
    db.session.commit()
    return n


# ==================== Server info (read-only env) ====================


def server_info() -> dict:
    """Return read-only server metadata the settings page surfaces.

    These are env-driven (not user settings) but are useful to display
    on the settings page so the user can copy the URL and token for
    their Health Connect companion app.
    """
    host = os.environ.get("HOST", "127.0.0.1")
    if host in ("0.0.0.0", "::"):
        # Try to guess the LAN IP for convenience.
        import socket

        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            host = s.getsockname()[0]
            s.close()
        except OSError:
            host = "127.0.0.1"
    port = os.environ.get("PORT", "5000")
    return {
        "server_url": f"http://{host}:{port}",
        "ingest_token_set": bool(os.environ.get("INGEST_TOKEN")),
        "ingest_token_hint": (
            "Set INGEST_TOKEN in the server's environment to enable the "
            "Health Connect companion app."
        ),
        "secret_key_set": bool(os.environ.get("SECRET_KEY")),
    }
