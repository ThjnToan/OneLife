"""Tests for the Samsung Health CSV importer and the related
/health/import-samsung endpoint."""

from __future__ import annotations

import io
import os
import zipfile
from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.services.samsung_health import (
    DayAggregate,
    _classify_csv,
    _local_date,
    _parse_step_daily_trend,
    _read_csv_text,
    merge_into_health_entries,
    parse_zip,
)

TZ_VIETNAM = timezone(timedelta(hours=7))
SAMPLE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "samsung_sample.zip")


# ----------------------- Pure parser tests -----------------------


class TestLocalDate:
    def test_utc_midnight_ict_is_next_day(self):
        # 2026-05-28 17:00 UTC = 2026-05-29 00:00 ICT
        ms = int(datetime(2026, 5, 28, 17, 0, tzinfo=UTC).timestamp() * 1000)
        assert _local_date(ms, 420) == "2026-05-29"

    def test_utc_afternoon_ict_same_day(self):
        # 2026-05-28 10:00 UTC = 2026-05-28 17:00 ICT
        ms = int(datetime(2026, 5, 28, 10, 0, tzinfo=UTC).timestamp() * 1000)
        assert _local_date(ms, 420) == "2026-05-28"

    def test_zero_offset(self):
        ms = int(datetime(2026, 5, 28, 12, 0, tzinfo=UTC).timestamp() * 1000)
        assert _local_date(ms, 0) == "2026-05-28"

    def test_string_input_accepted(self):
        ms = int(datetime(2026, 5, 28, 12, 0, tzinfo=UTC).timestamp() * 1000)
        assert _local_date(str(ms), 0) == "2026-05-28"


class TestClassifyCsv:
    def test_step_count(self):
        assert _classify_csv("com.samsung.health.step_count.csv") == ("step_count", "")

    def test_heart_rate(self):
        assert _classify_csv("com.samsung.health.heart_rate.csv") == ("heart_rate", "")

    def test_sleep_stage(self):
        assert _classify_csv("com.samsung.shealth.sleep_stage.csv") == ("sleep", "")

    def test_exercise(self):
        assert _classify_csv("com.samsung.health.exercise.csv") == ("exercise", "")

    def test_water(self):
        assert _classify_csv("com.samsung.health.water_intake.csv") == ("water_intake", "")

    def test_unknown(self):
        assert _classify_csv("com.samsung.health.blood_pressure.csv") is None

    def test_date_suffixed_real_export_names(self):
        """Real Samsung exports append a 14-digit date stamp to each
        filename. The classifier must still resolve the table type."""
        assert _classify_csv(
            "com.samsung.shealth.tracker.pedometer_step_count.20260604153209.csv"
        ) == ("step_count", "")
        assert _classify_csv("com.samsung.shealth.tracker.heart_rate.20260604153209.csv") == (
            "heart_rate",
            "",
        )
        assert _classify_csv("com.samsung.health.weight.20260604153209.csv") == ("weight", "")
        assert _classify_csv("com.samsung.shealth.sleep.20260604153209.csv") == ("sleep", "")
        assert _classify_csv("com.samsung.shealth.calories_burned.details.20260604153209.csv") == (
            "calories",
            "calorie",
        )
        # step_daily_trend has its own kind (different parsing rules)
        assert _classify_csv("com.samsung.shealth.step_daily_trend.20260604153209.csv") == (
            "step_daily_trend",
            "",
        )

    def test_substring_traps_rejected(self):
        """Files that contain a known substring but aren't the
        canonical table must be skipped, not imported."""
        # Sleep traps
        assert _classify_csv("com.samsung.health.sleep_apnea.csv") is None
        assert _classify_csv("com.samsung.shealth.sleep_goal.csv") is None
        assert _classify_csv("com.samsung.shealth.sleep_raw_data.csv") is None
        assert _classify_csv("com.samsung.shealth.sleep_snoring.csv") is None
        assert _classify_csv("com.samsung.shealth.sleep_combined.csv") is None
        # Exercise sub-files
        assert _classify_csv("com.samsung.shealth.exercise.hr_zone.csv") is None
        assert _classify_csv("com.samsung.shealth.exercise.weather.csv") is None
        assert _classify_csv("com.samsung.shealth.exercise.recovery_heart_rate.csv") is None
        assert _classify_csv("com.samsung.shealth.exercise.max_heart_rate.csv") is None
        assert _classify_csv("com.samsung.shealth.exercise.extension.csv") is None
        # HR alert records (not actual HR samples)
        assert _classify_csv("com.samsung.shealth.alerted_heart_rate.csv") is None
        # Goals and programs
        assert _classify_csv("com.samsung.shealth.goal.csv") is None
        assert _classify_csv("com.samsung.shealth.exercise.program.csv") is None


class TestReadCsvText:
    def test_skips_metadata_headers(self):
        raw = b"# samsung health export\n# data_type=step_count\n\nstart_time,end_time,count\n1000,2000,500\n"
        cols, rows = _read_csv_text(io.BytesIO(raw))
        assert cols == ["start_time", "end_time", "count"]
        rows = list(rows)
        assert len(rows) == 1
        assert rows[0]["count"] == "500"

    def test_empty(self):
        cols, rows = _read_csv_text(io.BytesIO(b""))
        assert cols == []
        assert list(rows) == []

    def test_handles_utf8_bom(self):
        raw = "\ufeffstart_time,count\n1000,42\n".encode()
        cols, rows = _read_csv_text(io.BytesIO(raw))
        assert "start_time" in cols
        assert list(rows)[0]["count"] == "42"


# ----------------------- step_daily_trend parser -----------------------


class TestStepDailyTrendParser:
    """The step_daily_trend table has 2-4 rows per day from different
    sources (phone, watch, Health Connect, plus re-aggregated copies).
    Summing them would double-count. The parser must dedupe by
    picking the highest `count` per day and using the corresponding
    distance/calorie from that row."""

    def _rows(self, *tuples):
        """Build trend rows. Each tuple: (day_time_ms, count, distance, calorie)."""
        return [
            {
                "day_time": str(d),
                "count": str(c),
                "distance": str(dist),
                "calorie": str(cal),
            }
            for d, c, dist, cal in tuples
        ]

    def test_duplicate_rows_take_one(self):
        # Two identical rows for the same day (common: fresh + stale)
        rows = self._rows(
            (1705795200000, 1528, 1125.74, 62.34), (1705795200000, 1528, 1125.74, 62.34)
        )
        out = {}
        total = _parse_step_daily_trend(rows, out, 420)
        assert total == 3056  # raw total still counts both
        assert out["2024-01-21"].steps == 1528  # but per-day is deduped
        # distance_km is the raw meters/1000 (rounded only at the API
        # boundary) — second row is a no-op (not a new max).
        assert abs(out["2024-01-21"].distance_km - 1.12574) < 1e-6
        assert out["2024-01-21"].step_calorie == 62

    def test_max_count_wins_for_day(self):
        # 4 rows: 5817, 6781, 3123, 3123 — should pick 6781 and use
        # ITS distance/calorie (5011m, 266.47kcal), not the lower rows'.
        rows = self._rows(
            (1705795200000, 5817, 4273.6, 225.98),
            (1705795200000, 6781, 5011.0, 266.47),
            (1705795200000, 3123, 2355.16, 123.09),
            (1705795200000, 3123, 2355.16, 123.09),
        )
        out = {}
        _parse_step_daily_trend(rows, out, 420)
        d = out["2024-01-21"]
        assert d.steps == 6781
        assert abs(d.distance_km - 5.011) < 1e-6
        assert d.step_calorie == 266

    def test_does_not_lower_existing_steps(self):
        # If pedometer already filled agg.steps with a higher value,
        # the trend parser should not lower it. The trend's
        # distance/calorie don't overwrite either (since this row
        # is not a new max for the day).
        out = {
            "2024-01-21": DayAggregate(
                date="2024-01-21", steps=10000, distance_km=8.5, step_calorie=350
            )
        }
        rows = self._rows((1705795200000, 5000, 4000.0, 200.0))
        _parse_step_daily_trend(rows, out, 420)
        # Pedometer's values stay; trend's lower row is ignored.
        assert out["2024-01-21"].steps == 10000
        assert out["2024-01-21"].distance_km == 8.5
        assert out["2024-01-21"].step_calorie == 350

    def test_zero_values_skipped(self):
        # distance=0 and calorie=0 in the file should not be stored.
        out = {}
        rows = self._rows((1705795200000, 1000, 0, 0))
        _parse_step_daily_trend(rows, out, 420)
        d = out["2024-01-21"]
        assert d.steps == 1000
        assert d.distance_km is None
        assert d.step_calorie is None


# ----------------------- End-to-end parser -----------------------


class TestParseZip:
    def test_sample_zip_parses(self):
        with open(SAMPLE_PATH, "rb") as f:
            parsed = parse_zip(f.read(), tz_offset_minutes=420)

        assert len(parsed.raw_files) == 8
        assert parsed.skipped_files == []
        assert parsed.total_steps == 63_000
        assert parsed.total_heart_rate_samples == 42
        assert parsed.total_sleep_sessions == 7
        assert parsed.date_range == ("2026-05-28", "2026-06-04")
        assert "2026-05-30" in parsed.days
        # The 30-min run lives on May 30
        d = parsed.days["2026-05-30"]
        assert d.workout_minutes == 30
        assert len(d.exercises) == 1
        assert d.exercises[0]["type"] == "running"
        # Weight decreases by 0.1/day
        assert parsed.days["2026-05-28"].weight == 72.0
        assert parsed.days["2026-06-03"].weight == 71.4
        # raw_files preserves zip order, not sorted
        assert isinstance(parsed.raw_files, list)

    def test_unknown_files_are_skipped(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("com.samsung.health.unknown_metric.csv", b"start_time,value\n1000,1\n")
            zf.writestr("README.txt", b"hello")
        parsed = parse_zip(buf.getvalue(), tz_offset_minutes=0)
        # README.txt is not a .csv, so it's filtered out before classification
        assert "com.samsung.health.unknown_metric.csv" in parsed.skipped_files
        assert parsed.days == {}

    def test_invalid_zip_raises(self):
        with pytest.raises(Exception):
            parse_zip(b"not a zip", tz_offset_minutes=0)

    def test_sleep_attributed_to_wake_day(self):
        # Build a tiny zip with a sleep session ending on a known date
        start = datetime(2026, 5, 28, 23, 30, tzinfo=TZ_VIETNAM)
        end = datetime(2026, 5, 29, 7, 0, tzinfo=TZ_VIETNAM)
        rows = [
            "# samsung health",
            "",
            "start_time,end_time,stage",
            f"{int(start.timestamp()*1000)},{int(end.timestamp()*1000)},light",
        ]
        body = "\n".join(rows).encode()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("com.samsung.shealth.sleep_stage.csv", body)
        parsed = parse_zip(buf.getvalue(), tz_offset_minutes=420)
        # Session is 7.5h ending on 5/29 → should land on 5/29
        assert "2026-05-29" in parsed.days
        d = parsed.days["2026-05-29"]
        assert d.sleep_minutes == 450
        # (sleep_hours is only set by merge_into_health_entries; the
        # parser tracks raw minutes to avoid lossy float conversion)


class TestMergeIntoHealthEntries:
    def test_payload_structure(self):
        with open(SAMPLE_PATH, "rb") as f:
            parsed = parse_zip(f.read(), tz_offset_minutes=420)
        payloads = merge_into_health_entries(parsed)
        assert payloads  # non-empty
        # Each payload has a date and at least one metric
        for p in payloads:
            assert "date" in p
            metric_keys = {k for k in p if k != "date"}
            assert metric_keys, f"empty payload: {p}"

    def test_sleep_hours_converted_from_minutes(self):
        with open(SAMPLE_PATH, "rb") as f:
            parsed = parse_zip(f.read(), tz_offset_minutes=420)
        payloads = merge_into_health_entries(parsed)
        sleeps = [p for p in payloads if "sleep_hours" in p]
        assert sleeps, "expected at least one day with sleep_hours"
        # 465 min / 60 = 7.75
        assert all(6.0 <= p["sleep_hours"] <= 9.0 for p in sleeps)


# ----------------------- HTTP endpoint -----------------------


@pytest.fixture
def sample_bytes():
    with open(SAMPLE_PATH, "rb") as f:
        return f.read()


class TestImportEndpoint:
    def test_preview_does_not_write(self, client, sample_bytes):
        rv = client.post(
            "/api/health/import-samsung?tz_offset_minutes=420",
            data=sample_bytes,
            content_type="application/zip",
        )
        assert rv.status_code == 200
        body = rv.get_json()
        assert body["status"] == "preview"
        assert body["summary"]["total_steps"] == 63_000
        # Nothing was written
        from app.models import HealthEntry, HeartRateSample, SleepSession

        assert HealthEntry.query.count() == 0
        assert HeartRateSample.query.count() == 0
        assert SleepSession.query.count() == 0

    def test_preview_includes_rich_per_day_breakdown(self, client, sample_bytes):
        rv = client.post(
            "/api/health/import-samsung?tz_offset_minutes=420",
            data=sample_bytes,
            content_type="application/zip",
        )
        body = rv.get_json()
        days = body["summary"]["per_day"]
        assert len(days) >= 1
        # The synthetic fixture has 7 days of data. Find one with HR samples
        # and one with an exercise session.
        hr_day = next((d for d in days if d["heart_rate_samples"] > 0), None)
        assert hr_day is not None
        assert hr_day["heart_rate_min"] is not None
        assert hr_day["heart_rate_max"] >= hr_day["heart_rate_min"]
        assert hr_day["heart_rate_avg"] is not None
        # Exercise detail
        ex_day = next((d for d in days if d["exercises"] > 0), None)
        assert ex_day is not None
        assert len(ex_day["exercises_detail"]) == ex_day["exercises"]
        assert ex_day["exercises_detail"][0]["type"]
        assert ex_day["exercises_detail"][0]["duration_minutes"] is not None
        # Sleep detail
        sleep_day = next((d for d in days if d["sleep_sessions"] > 0), None)
        assert sleep_day is not None
        assert len(sleep_day["sleep_detail"]) == sleep_day["sleep_sessions"]
        assert sleep_day["sleep_detail"][0]["start"] is not None
        assert sleep_day["sleep_detail"][0]["end"] is not None
        assert sleep_day["sleep_detail"][0]["duration_minutes"] is not None
        assert sleep_day["sleep_detail"][0]["duration_minutes"] > 0

    def test_confirm_writes(self, client, sample_bytes):
        rv = client.post(
            "/api/health/import-samsung?tz_offset_minutes=420&confirm=true",
            data=sample_bytes,
            content_type="application/zip",
        )
        assert rv.status_code == 200
        body = rv.get_json()
        assert body["status"] == "imported"
        assert body["written"]["health_entries"] == 8
        assert body["written"]["heart_rate_samples"] == 42
        assert body["written"]["sleep_sessions"] == 7

        from app.models import HealthEntry, HeartRateSample, SleepSession

        assert HealthEntry.query.count() == 8
        assert HeartRateSample.query.count() == 42
        assert SleepSession.query.count() == 7

    def test_idempotent_reimport(self, client, sample_bytes):
        # First import
        client.post(
            "/api/health/import-samsung?tz_offset_minutes=420&confirm=true",
            data=sample_bytes,
            content_type="application/zip",
        )
        # Re-import same data
        rv = client.post(
            "/api/health/import-samsung?tz_offset_minutes=420&confirm=true",
            data=sample_bytes,
            content_type="application/zip",
        )
        body = rv.get_json()
        assert body["written"]["health_entries"] == 0
        assert body["written"]["heart_rate_samples"] == 0
        assert body["written"]["sleep_sessions"] == 0
        assert body["skipped"]["health_entries"] == 8
        assert body["skipped"]["heart_rate_samples"] == 42
        assert body["skipped"]["sleep_sessions"] == 7

    def test_user_entered_data_preserved(self, client, sample_bytes, app):
        # Pre-populate a manual health entry on a day the import will touch
        from datetime import date

        from app.extensions import db
        from app.models import HealthEntry

        with app.app_context():
            existing = HealthEntry(
                date=date(2026, 5, 30),
                steps=99999,  # user-entered value
                mood="great",
                notes="my own notes",
            )
            db.session.add(existing)
            db.session.commit()

        client.post(
            "/api/health/import-samsung?tz_offset_minutes=420&confirm=true",
            data=sample_bytes,
            content_type="application/zip",
        )

        with app.app_context():
            entry = HealthEntry.query.filter_by(date=date(2026, 5, 30)).one()
            # User-entered values preserved
            assert entry.steps == 99999
            assert entry.mood == "great"
            assert entry.notes == "my own notes"
            # But Samsung data filled the gaps
            assert entry.water_liters == 0.75
            assert entry.sleep_hours == 7.75
            assert entry.workout_minutes == 30

    def test_empty_upload_400(self, client):
        rv = client.post("/api/health/import-samsung", data=b"", content_type="application/zip")
        assert rv.status_code == 400

    def test_garbage_zip_400(self, client):
        rv = client.post(
            "/api/health/import-samsung?confirm=true",
            data=b"not a zip",
            content_type="application/zip",
        )
        assert rv.status_code == 400


# ----------------------- New GET endpoints -----------------------


class TestHeartRateEndpoint:
    def test_returns_recent(self, client, sample_bytes):
        client.post(
            "/api/health/import-samsung?tz_offset_minutes=420&confirm=true",
            data=sample_bytes,
            content_type="application/zip",
        )
        rv = client.get("/api/health/heart-rate?limit=10")
        assert rv.status_code == 200
        rows = rv.get_json()
        assert len(rows) == 10
        # Newest first
        ts = [r["timestamp"] for r in rows]
        assert ts == sorted(ts, reverse=True)


class TestSleepEndpoint:
    def test_returns_recent(self, client, sample_bytes):
        client.post(
            "/api/health/import-samsung?tz_offset_minutes=420&confirm=true",
            data=sample_bytes,
            content_type="application/zip",
        )
        rv = client.get("/api/health/sleep?limit=30")
        assert rv.status_code == 200
        rows = rv.get_json()
        assert len(rows) == 7
        for s in rows:
            assert "start_time" in s
            assert "end_time" in s
            assert "duration_minutes" in s


# ----------------------- /api/health/ingest (Health Connect) -----------------------

from datetime import timedelta, timezone


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def _set_ingest_token(monkeypatch, app, token: str = "test-token"):
    """Patch the running app's config so the ingest endpoint accepts
    the given token. Works inside the ``app`` fixture's app context."""
    import hashlib

    digest = hashlib.sha256(token.encode()).hexdigest()
    app.config["INGEST_TOKEN_SHA256"] = digest
    monkeypatch.setenv("INGEST_TOKEN", token)
    return token


class TestIngestAuth:
    def test_no_token_env_returns_503(self, client, app):
        # Default fixture has no INGEST_TOKEN env var
        rv = client.post("/api/health/ingest", json={"steps": []})
        assert rv.status_code == 503
        assert "disabled" in rv.get_json()["error"].lower()

    def test_missing_auth_header_401(self, client, app, monkeypatch):
        _set_ingest_token(monkeypatch, app)
        rv = client.post("/api/health/ingest", json={"steps": []})
        assert rv.status_code == 401

    def test_wrong_token_401(self, client, app, monkeypatch):
        _set_ingest_token(monkeypatch, app, "correct-token")
        rv = client.post(
            "/api/health/ingest",
            json={"steps": []},
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert rv.status_code == 401

    def test_correct_token_accepted(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        rv = client.post(
            "/api/health/ingest",
            json={"steps": []},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert rv.status_code == 200


class TestIngestSteps:
    def test_aggregates_per_local_day(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        # 2026-06-04 02:00 UTC = 2026-06-04 09:00 ICT
        tz = 420
        body = {
            "tz_offset_minutes": tz,
            "steps": [
                {
                    "start": "2026-06-04T02:00:00+00:00",
                    "end": "2026-06-04T03:00:00+00:00",
                    "count": 1500,
                },
                {
                    "start": "2026-06-04T03:00:00+00:00",
                    "end": "2026-06-04T04:00:00+00:00",
                    "count": 800,
                },
                {
                    "start": "2026-06-05T01:00:00+00:00",
                    "end": "2026-06-05T02:00:00+00:00",
                    "count": 3000,
                },
            ],
        }
        rv = client.post(
            "/api/health/ingest",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert rv.status_code == 200
        body = rv.get_json()
        assert body["written"]["steps_days"] == 2
        assert body["skipped"]["steps_days"] == 0

        # Confirm HealthEntry has the right values
        from datetime import date

        from app.models import HealthEntry

        d1 = HealthEntry.query.filter_by(date=date(2026, 6, 4)).one()
        assert d1.steps == 2300  # 1500+800 on the same day
        d2 = HealthEntry.query.filter_by(date=date(2026, 6, 5)).one()
        assert d2.steps == 3000

    def test_takes_max_not_sum_when_re_ingesting(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        # First sync: 5000 steps
        client.post(
            "/api/health/ingest",
            json={
                "tz_offset_minutes": 0,
                "steps": [
                    {"start": "2026-06-04T10:00:00Z", "end": "2026-06-04T11:00:00Z", "count": 5000}
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        # Second sync: 3000 steps (lower, should not overwrite)
        rv = client.post(
            "/api/health/ingest",
            json={
                "tz_offset_minutes": 0,
                "steps": [
                    {"start": "2026-06-04T10:00:00Z", "end": "2026-06-04T11:00:00Z", "count": 3000}
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        from datetime import date

        from app.models import HealthEntry

        entry = HealthEntry.query.filter_by(date=date(2026, 6, 4)).one()
        assert entry.steps == 5000  # kept the higher value
        assert rv.get_json()["skipped"]["steps_days"] == 1


class TestIngestHeartRate:
    def test_stores_samples(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        rv = client.post(
            "/api/health/ingest",
            json={
                "tz_offset_minutes": 0,
                "heart_rate": [
                    {"timestamp": "2026-06-04T10:00:00Z", "bpm": 72},
                    {"timestamp": "2026-06-04T10:01:00Z", "bpm": 75},
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert rv.status_code == 200
        assert rv.get_json()["written"]["heart_rate"] == 2

        from app.models import HeartRateSample

        samples = HeartRateSample.query.filter_by(source="health_connect").all()
        assert len(samples) == 2
        assert {s.bpm for s in samples} == {72, 75}

    def test_dedupes_repeated_samples(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        for _ in range(3):
            client.post(
                "/api/health/ingest",
                json={
                    "tz_offset_minutes": 0,
                    "heart_rate": [{"timestamp": "2026-06-04T10:00:00Z", "bpm": 72}],
                },
                headers={"Authorization": f"Bearer {token}"},
            )

        from app.models import HeartRateSample

        assert HeartRateSample.query.filter_by(source="health_connect").count() == 1

    def test_rejects_out_of_range_bpm(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        rv = client.post(
            "/api/health/ingest",
            json={
                "tz_offset_minutes": 0,
                "heart_rate": [
                    {"timestamp": "2026-06-04T10:00:00Z", "bpm": 5},  # too low
                    {"timestamp": "2026-06-04T10:00:00Z", "bpm": 500},  # too high
                    {"timestamp": "2026-06-04T10:00:00Z", "bpm": 72},  # valid
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert rv.get_json()["written"]["heart_rate"] == 1


class TestIngestSleep:
    def test_stores_session_and_folds_into_health_entry(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        # Sleep 23:00 → 07:00 UTC, ends on 2026-06-04
        rv = client.post(
            "/api/health/ingest",
            json={
                "tz_offset_minutes": 0,
                "sleep": [
                    {
                        "start": "2026-06-03T23:00:00Z",
                        "end": "2026-06-04T07:00:00Z",
                        "stages": [
                            {
                                "stage": "light",
                                "start": "2026-06-03T23:00:00Z",
                                "end": "2026-06-04T01:00:00Z",
                            },
                            {
                                "stage": "deep",
                                "start": "2026-06-04T01:00:00Z",
                                "end": "2026-06-04T03:00:00Z",
                            },
                        ],
                    }
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert rv.status_code == 200
        assert rv.get_json()["written"]["sleep_sessions"] == 1

        from datetime import date

        from app.models import HealthEntry, SleepSession

        s = SleepSession.query.filter_by(source="health_connect").one()
        assert s.duration_minutes == 8 * 60
        assert s.stages_json is not None
        # wake day
        entry = HealthEntry.query.filter_by(date=date(2026, 6, 4)).one()
        assert entry.sleep_hours == 8.0

    def test_dedupes_session(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        for _ in range(2):
            client.post(
                "/api/health/ingest",
                json={
                    "tz_offset_minutes": 0,
                    "sleep": [{"start": "2026-06-03T23:00:00Z", "end": "2026-06-04T07:00:00Z"}],
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        from app.models import SleepSession

        assert SleepSession.query.filter_by(source="health_connect").count() == 1


class TestIngestWeight:
    def test_takes_last_per_day(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        client.post(
            "/api/health/ingest",
            json={
                "tz_offset_minutes": 0,
                "weight": [
                    {"timestamp": "2026-06-04T07:00:00Z", "kg": 71.5},
                    {"timestamp": "2026-06-04T19:00:00Z", "kg": 71.8},  # later
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        from datetime import date

        from app.models import HealthEntry

        entry = HealthEntry.query.filter_by(date=date(2026, 6, 4)).one()
        assert entry.weight == 71.8


class TestIngestPartial:
    def test_empty_body(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        rv = client.post(
            "/api/health/ingest", json={}, headers={"Authorization": f"Bearer {token}"}
        )
        assert rv.status_code == 200
        assert rv.get_json()["written"] == {}

    def test_unknown_keys_ignored(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        rv = client.post(
            "/api/health/ingest",
            json={
                "steps": [
                    {"start": "2026-06-04T10:00:00Z", "end": "2026-06-04T11:00:00Z", "count": 100}
                ],
                "garbage": "ignored",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert rv.status_code == 200
        assert rv.get_json()["written"]["steps_days"] == 1

    def test_invalid_json_400(self, client, app, monkeypatch):
        token = _set_ingest_token(monkeypatch, app)
        rv = client.post(
            "/api/health/ingest",
            data="not json",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        assert rv.status_code == 400
