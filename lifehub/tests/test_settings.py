"""Tests for the user settings API + service."""

from __future__ import annotations

import pytest

from app.extensions import db
from app.models import UserSetting
from app.services import settings as svc

# ==================== SERVICE ====================


class TestSettingSpec:
    def test_coerce_bool_truthy(self):
        spec = svc.REGISTRY["hide_net_worth_on_dashboard"]
        for v in (True, 1, "1", "true", "yes", "on"):
            assert spec.coerce(v) is True

    def test_coerce_bool_falsy(self):
        spec = svc.REGISTRY["hide_net_worth_on_dashboard"]
        for v in (False, 0, "0", "false", "no", "off", ""):
            assert spec.coerce(v) is False

    def test_coerce_bool_invalid(self):
        spec = svc.REGISTRY["hide_net_worth_on_dashboard"]
        with pytest.raises(ValueError):
            spec.coerce("maybe")

    def test_coerce_int_with_bounds(self):
        spec = svc.REGISTRY["step_goal"]
        assert spec.coerce("10000") == 10000
        with pytest.raises(ValueError):
            spec.coerce("-1")
        with pytest.raises(ValueError):
            spec.coerce("1000000")

    def test_coerce_float(self):
        spec = svc.REGISTRY["water_goal_liters"]
        assert spec.coerce("2.5") == 2.5
        with pytest.raises(ValueError):
            spec.coerce("twenty")

    def test_coerce_choice(self):
        spec = svc.REGISTRY["theme"]
        assert spec.coerce("dark") == "dark"
        with pytest.raises(ValueError):
            spec.coerce("rainbow")

    def test_coerce_string_max_length(self):
        spec = svc.REGISTRY["currency_symbol"]
        with pytest.raises(ValueError):
            spec.coerce("x" * 100)


class TestSettingsService:
    def test_get_unknown_returns_default(self, app):
        with app.app_context():
            assert svc.get("nonsense") is None
            assert svc.get("nonsense", "fallback") == "fallback"

    def test_get_known_returns_default_when_unset(self, app):
        with app.app_context():
            assert svc.get("step_goal") == 10000
            assert svc.get("theme") == "auto"
            assert svc.get("hide_net_worth_on_dashboard") is False

    def test_set_then_get_round_trip(self, app):
        with app.app_context():
            svc.set_value("step_goal", 7500)
            assert svc.get("step_goal") == 7500
            assert db.session.get(UserSetting, "step_goal").value == "7500"

    def test_set_value_validates(self, app):
        with app.app_context():
            with pytest.raises(ValueError):
                svc.set_value("step_goal", -1)
            with pytest.raises(ValueError):
                svc.set_value("theme", "neon")

    def test_set_value_rejects_unknown_key(self, app):
        with app.app_context():
            with pytest.raises(ValueError):
                svc.set_value("made_up_key", "x")

    def test_set_many_partial_errors(self, app):
        with app.app_context():
            applied, errors = svc.set_many({"step_goal": 8000, "theme": "neon"})
            assert applied == {}
            assert len(errors) == 1
            assert "neon" in errors[0]
            # And the step_goal was NOT saved
            assert svc.get("step_goal") == 10000

    def test_set_many_unknown_key(self, app):
        with app.app_context():
            applied, errors = svc.set_many({"bogus": "x"})
            assert "Unknown setting" in errors[0]
            assert applied == {}

    def test_set_many_overwrites_existing(self, app):
        with app.app_context():
            svc.set_value("step_goal", 5000)
            applied, errors = svc.set_many({"step_goal": 9000, "theme": "dark"})
            assert errors == []
            assert applied == {"step_goal": 9000, "theme": "dark"}
            assert svc.get("step_goal") == 9000
            assert svc.get("theme") == "dark"

    def test_all_settings_grouped(self, app):
        with app.app_context():
            data = svc.all_settings()
            assert "groups" in data
            assert "settings" in data
            assert set(data["settings"].keys()) == {"display", "health", "privacy"}
            for grp in data["groups"]:
                assert grp["id"] in data["settings"]
            # Every registry key is present
            keys = {s["key"] for grp in data["settings"].values() for s in grp}
            assert keys == set(svc.REGISTRY.keys())

    def test_reset_all(self, app):
        with app.app_context():
            svc.set_value("step_goal", 1234)
            svc.set_value("theme", "dark")
            n = svc.reset_all()
            assert n == 2
            assert svc.get("step_goal") == 10000
            assert svc.get("theme") == "auto"

    def test_coerces_corrupt_db_value(self, app):
        with app.app_context():
            db.session.add(UserSetting(key="step_goal", value="not-a-number"))
            db.session.commit()
            # Coercion fails -> falls back to default
            assert svc.get("step_goal") == 10000

    def test_bool_storage_round_trip(self, app):
        with app.app_context():
            svc.set_value("hide_net_worth_on_dashboard", True)
            raw = db.session.get(UserSetting, "hide_net_worth_on_dashboard").value
            assert raw in ("True", "true", "1")  # str(True)
            assert svc.get("hide_net_worth_on_dashboard") is True


class TestServerInfo:
    def test_returns_known_keys(self, app):
        with app.app_context():
            info = svc.server_info()
            assert "server_url" in info
            assert info["server_url"].startswith("http://")
            assert "ingest_token_set" in info
            assert "secret_key_set" in info


# ==================== ROUTES ====================


class TestSettingsRoutes:
    def test_get_returns_defaults(self, client):
        r = client.get("/api/settings")
        assert r.status_code == 200
        body = r.get_json()
        assert "display" in body["settings"]
        assert "health" in body["settings"]
        assert "privacy" in body["settings"]
        step = next(s for s in body["settings"]["health"] if s["key"] == "step_goal")
        assert step["value"] == 10000

    def test_put_updates_values(self, client):
        r = client.put(
            "/api/settings",
            json={
                "step_goal": 7500,
                "theme": "dark",
                "hide_net_worth_on_dashboard": True,
            },
        )
        assert r.status_code == 200
        body = r.get_json()
        assert body["applied"]["step_goal"] == 7500
        assert body["applied"]["theme"] == "dark"
        # GET reflects new values
        r2 = client.get("/api/settings")
        b2 = r2.get_json()
        step = next(s for s in b2["settings"]["health"] if s["key"] == "step_goal")
        assert step["value"] == 7500

    def test_put_validates_and_returns_400(self, client):
        r = client.put(
            "/api/settings",
            json={
                "step_goal": -1,
                "theme": "neon",
            },
        )
        assert r.status_code == 400
        body = r.get_json()
        assert "Validation failed" in body["error"]
        assert any("step_goal" in e for e in body["details"])
        assert any("theme" in e for e in body["details"])
        # No values saved (transaction rolled back)
        r2 = client.get("/api/settings")
        step = next(s for s in r2.get_json()["settings"]["health"] if s["key"] == "step_goal")
        assert step["value"] == 10000

    def test_put_rejects_non_dict(self, client):
        r = client.put("/api/settings", json=["not", "a", "dict"])
        assert r.status_code == 400

    def test_reset_clears_values(self, client):
        client.put("/api/settings", json={"step_goal": 5555})
        r = client.post("/api/settings/reset")
        assert r.status_code == 200
        assert r.get_json()["deleted"] >= 1
        r2 = client.get("/api/settings")
        step = next(s for s in r2.get_json()["settings"]["health"] if s["key"] == "step_goal")
        assert step["value"] == 10000

    def test_server_info(self, client):
        r = client.get("/api/server-info")
        assert r.status_code == 200
        b = r.get_json()
        assert "server_url" in b
        assert "ingest_token_set" in b
