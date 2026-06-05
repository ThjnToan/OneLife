"""Tests for the asset valuation history feature."""

from __future__ import annotations

from datetime import date, timedelta


def _create_asset(client, **overrides):
    payload = {
        "name": "Test Stock",
        "asset_type": "stock",
        "current_value": 1000.0,
    }
    payload.update(overrides)
    rv = client.post("/api/assets", json=payload)
    assert rv.status_code == 201, rv.get_data(as_text=True)
    return rv.get_json()


def test_create_asset_records_initial_valuation(client):
    asset = _create_asset(client, current_value=1500.0)
    assert asset["current_value"] == 1500.0
    # The asset comes back with valuation history; today's value is recorded.
    assert len(asset["valuations"]) == 1
    assert asset["valuations"][0]["date"] == date.today().isoformat()
    assert asset["valuations"][0]["value"] == 1500.0


def test_create_with_valuation_date_backdates(client):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    asset = _create_asset(client, current_value=2000.0, valuation_date=yesterday)
    assert asset["valuations"][0]["date"] == yesterday
    assert asset["valuations"][0]["value"] == 2000.0


def test_put_unchanged_value_does_not_record(client):
    asset = _create_asset(client, current_value=1000.0)
    rv = client.put(f"/api/assets/{asset['id']}", json={"current_value": 1000.0})
    assert rv.status_code == 200
    assert len(rv.get_json()["valuations"]) == 1  # still just today


def test_put_changed_value_records_today(client):
    asset = _create_asset(client, current_value=1000.0)
    rv = client.put(f"/api/assets/{asset['id']}", json={"current_value": 1200.0})
    assert rv.status_code == 200
    body = rv.get_json()
    assert body["current_value"] == 1200.0
    # Daily upsert: same day, so there's exactly one row for today,
    # with the latest value.
    assert len(body["valuations"]) == 1
    assert body["valuations"][0]["date"] == date.today().isoformat()
    assert body["valuations"][0]["value"] == 1200.0


def test_patch_value_records_and_overwrites_same_day(client):
    asset = _create_asset(client, current_value=1000.0)
    rv = client.patch(
        f"/api/assets/{asset['id']}/value",
        json={"current_value": 1500.0},
    )
    assert rv.status_code == 200
    assert rv.get_json()["valuations"][0]["value"] == 1500.0

    # Same day, different value: still one row, with the latest value.
    rv = client.patch(
        f"/api/assets/{asset['id']}/value",
        json={"current_value": 1700.0},
    )
    assert rv.status_code == 200
    rows = rv.get_json()["valuations"]
    assert len(rows) == 1
    assert rows[0]["value"] == 1700.0


def test_full_history_endpoint(client):
    asset = _create_asset(client, current_value=1000.0)
    # Create a backdated valuation via the PUT override.
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    day_before = (date.today() - timedelta(days=2)).isoformat()
    # We can't add backdated rows through the API in a single call,
    # so insert one via the service helper by calling PUT with a
    # backdated valuation_date. The PUT compares the new value to
    # the current value to decide whether to record.
    rv = client.put(
        f"/api/assets/{asset['id']}",
        json={"current_value": 1001.0, "valuation_date": day_before},
    )
    assert rv.status_code == 200
    # Another backdated entry.
    rv = client.put(
        f"/api/assets/{asset['id']}",
        json={"current_value": 1002.0, "valuation_date": yesterday},
    )
    assert rv.status_code == 200

    rv = client.get(f"/api/assets/{asset['id']}/valuations")
    assert rv.status_code == 200
    body = rv.get_json()
    assert body["asset_id"] == asset["id"]
    assert body["days"] is None
    dates = [v["date"] for v in body["valuations"]]
    # Oldest first.
    assert dates == sorted(dates)
    assert day_before in dates
    assert yesterday in dates
    assert date.today().isoformat() in dates


def test_history_with_days_filter(client):
    asset = _create_asset(client, current_value=1000.0)
    # Backdate 5 entries across the past 10 days.
    for i in range(5):
        d = (date.today() - timedelta(days=i * 2)).isoformat()
        client.put(
            f"/api/assets/{asset['id']}",
            json={"current_value": 1000.0 + i, "valuation_date": d},
        )
    rv = client.get(f"/api/assets/{asset['id']}/valuations?days=3")
    assert rv.status_code == 200
    body = rv.get_json()
    assert body["days"] == 3
    # The 3 most recent calendar days (today, -1, -2) only.
    dates = [v["date"] for v in body["valuations"]]
    assert all(
        date.fromisoformat(d) >= date.today() - timedelta(days=2) for d in dates
    )


def test_get_asset_includes_valuation_history(client):
    asset = _create_asset(client, current_value=100.0)
    rv = client.get(f"/api/assets/{asset['id']}")
    assert rv.status_code == 200
    body = rv.get_json()
    assert "valuations" in body
    assert isinstance(body["valuations"], list)
    assert len(body["valuations"]) >= 1


def test_collection_with_history_query_param(client):
    _create_asset(client, current_value=100.0)
    rv = client.get("/api/assets?with_history=1")
    assert rv.status_code == 200
    for a in rv.get_json():
        assert "valuations" in a
    rv = client.get("/api/assets")
    assert rv.status_code == 200
    for a in rv.get_json():
        # Default collection response does not embed history.
        assert "valuations" not in a


def test_delete_asset_cascades_to_valuations(client, app):
    asset = _create_asset(client, current_value=100.0)
    from app.models import AssetValuation

    with app.app_context():
        n = AssetValuation.query.filter_by(asset_id=asset["id"]).count()
        assert n == 1

    rv = client.delete(f"/api/assets/{asset['id']}")
    assert rv.status_code == 200

    with app.app_context():
        n = AssetValuation.query.filter_by(asset_id=asset["id"]).count()
        assert n == 0


def test_patch_value_validation(client):
    asset = _create_asset(client, current_value=100.0)
    rv = client.patch(
        f"/api/assets/{asset['id']}/value",
        json={"current_value": "not-a-number"},
    )
    assert rv.status_code == 400
    rv = client.patch(
        f"/api/assets/{asset['id']}/value",
        json={"current_value": -50},
    )
    assert rv.status_code == 400
    rv = client.patch(f"/api/assets/{asset['id']}/value", json={})
    assert rv.status_code == 400
