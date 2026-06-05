# OneLife - Personal Management System

A complete, local-only web app to manage every aspect of your life. All data
is stored on your computer — no internet required, no cloud, completely
private. Originally built as a single-file Flask app, OneLife is now
organised into blueprints with a proper service layer, tests, Docker
support, and a PWA manifest.

## What's inside

11 integrated modules (all amounts in Vietnamese Dong - VND):

1. **Dashboard** - Tasks, finance, **net worth**, health, upcoming events, recent activity
2. **Tasks** - Todos, projects, habits with consecutive-day streaks
3. **Health** - Weight, steps, workouts, sleep, mood, water, calories
4. **Finance** - Income/expense tracking in **VND**, budgets, monthly summaries
5. **Assets** - Cash, stocks, crypto, real estate, gold, vehicles, bonds
6. **Learning** - Books, courses, skills, notes with progress
7. **Calendar** - Events with categories and upcoming reminders
8. **Contacts** - Directory with search, birthdays, categories
9. **Documents** - File uploads, downloads, and folder organisation
10. **Journal** - Daily entries with mood, tags, favorites
11. **Goals** - Goal setting with progress bars and target dates

## Quick start

```bash
pip install -r requirements.txt
python wsgi.py
```

Then open **http://localhost:5000** in your browser.

Or with Docker:

```bash
docker compose up -d
```

Or on Windows, double-click `start.bat` (auto-starts Chrome in app mode).

## Project layout

```
onelife/
├── app/                  # Application package
│   ├── __init__.py       #   create_app() factory
│   ├── config.py         #   Config classes (dev/test/prod)
│   ├── extensions.py     #   db, migrate singletons
│   ├── models.py         #   SQLAlchemy models
│   ├── utils.py          #   Helpers (to_date, apply_update, ...)
│   ├── errors.py         #   JSON error handlers
│   ├── services/         #   Business logic (assets, tasks, networth)
│   └── routes/           #   Blueprints (tasks, finance, ...)
├── tests/                # pytest suite
├── migrations/           # Alembic (via Flask-Migrate)
│   └── versions/         #   Initial migration: 54422a558e94
├── static/               # css, js, img, manifest, service worker
├── templates/            # index.html
├── instance/             # SQLite DB lives here (gitignored)
├── uploads/              # User-uploaded files (gitignored)
├── wsgi.py               # Gunicorn / dev entry point
├── manage.py             # Flask CLI (for `flask db ...`)
├── pyproject.toml        # ruff / mypy / pytest config
├── Dockerfile
├── docker-compose.yml
├── Makefile
└── requirements.txt
```

## Configuration

All runtime config comes from environment variables. Copy `.env.example`
to `.env` and customise. Key variables:

| Variable               | Default                              | Purpose                       |
|------------------------|--------------------------------------|-------------------------------|
| `FLASK_ENV`            | `production`                         | dev / testing / production    |
| `SECRET_KEY`           | `dev-only-change-me`                 | Set in production             |
| `HOST`                 | `127.0.0.1`                          | Bind host                     |
| `PORT`                 | `5000`                               | Bind port                     |
| `DATABASE_URL`         | `sqlite:///instance/onelife.db`      | Any SQLAlchemy URI            |
| `UPLOAD_FOLDER`        | `./uploads`                          | Where uploads are stored      |
| `MAX_CONTENT_LENGTH_MB`| `50`                                 | Upload size limit             |
| `DEBUG`                | `0`                                  | Set to `1` only in dev        |
| `INGEST_TOKEN`         | *(unset, endpoint disabled)*         | Bearer token for `POST /api/health/ingest` (Health Connect Android app) |

> The default host is `127.0.0.1` (not `0.0.0.0`) so the app is **not**
> exposed to your LAN. Set `HOST=0.0.0.0` if you intentionally want that.

## Development

```bash
make install    # install deps + dev tools
make run        # dev server with debug
make test       # pytest
make lint       # ruff
make format     # ruff format
make typecheck  # mypy
make db-migrate # create a new Alembic migration
make db-upgrade # apply pending migrations
```

## Migrations

The app uses **Flask-Migrate (Alembic)** for schema changes. The initial
migration (`migrations/versions/54422a558e94_initial_schema.py`) creates
all 11 tables, all 16 indexes, foreign keys, and unique constraints.

**Fresh install:**

```bash
python wsgi.py    # or: make db-upgrade
```

The factory calls `db.create_all()` on first run, which is a no-op once
`alembic_version` is present. For a *truly* fresh database use:

```bash
flask --app manage db upgrade
```

**Existing database (upgrading from the pre-Alembic version):**

Your existing `instance/onelife.db` already has all the tables (created
by the old `db.create_all()`). Mark Alembic as up-to-date without
re-running the migration:

```bash
flask --app manage db stamp head
```

This inserts the `alembic_version` row and Alembic will now consider
the schema current. From this point on, schema changes go through
migrations instead of `create_all()`.

**Workflow for new schema changes:**

```bash
# 1. Edit app/models.py
# 2. Autogenerate the migration
flask --app manage db migrate -m "add foo column"
# 3. Review the generated file in migrations/versions/
# 4. Apply it
flask --app manage db upgrade
```

**Escapes & tooling notes:**

- The `SKIP_DB_INIT=1` env var makes the factory skip `db.create_all()`,
  `_ensure_schema_compatibility()`, and budget seeding. This is used when
  generating migrations (so Alembic sees an empty schema).
- The Makefile exposes `db-init`, `db-migrate`, `db-upgrade`, `db-downgrade`,
  `db-history`, and `db-stamp` targets.

## API overview

All endpoints are under `/api/`. Responses are JSON; errors come back as
`{"error": "..."}` with the appropriate status code.

- `/api/dashboard/summary` - single-call dashboard payload
- `/api/tasks`, `/api/tasks/<id>` - list/create/edit/delete
- `/api/health`, `/api/health/<id>`, `/api/health/stats`
- `/api/health/heart-rate` - recent heart-rate samples (query: `since`, `limit`)
- `/api/health/sleep` - recent sleep sessions (query: `since`, `limit`)
- `/api/health/import-samsung` (POST) - see [Samsung Health import](#samsung-health-import)
- `/api/health/ingest` (POST, bearer-token) - see [Real-time Health Connect sync](#real-time-health-connect-sync)
- `/api/transactions`, `/api/transactions/<id>`
- `/api/budgets`, `/api/budgets/<id>`
- `/api/assets`, `/api/assets/<id>`, `/api/assets/<id>/value` (PATCH)
- `/api/learning`, `/api/learning/<id>`
- `/api/events`, `/api/events/<id>`, `/api/events/upcoming`
- `/api/contacts`, `/api/contacts/<id>`
- `/api/folders`, `/api/folders/<id>`, `/api/folders/<id>/contents`
- `/api/documents`, `/api/documents/<id>`, `/api/documents/<id>/preview`
- `/api/journal`, `/api/journal/<id>`
- `/api/goals`, `/api/goals/<id>`
- `/api/search?q=...`
- `/api/export`, `/api/import` (POST)

## Samsung Health import

Samsung Health has no public API, so data is ingested from the app's
"Download personal data" CSV export. Covers steps, heart rate, sleep,
weight, water, calories (in/out), and exercise sessions from any
Galaxy Watch / Samsung Health app version.

**Web UI (recommended):**

On the **Health** page, scroll to the **"Samsung Health import"** card.
Click **"Get my Samsung data"** for a step-by-step export walkthrough,
then drop the `.zip` on the upload zone (or click to browse). The card
shows a **rich per-day preview table** (HR avg/min/max, sleep duration
per session, exercise list) before you commit. Click **Confirm
import** to write.

**API workflow:**

1. Open the Samsung Health app → **⋮ menu → Settings → Download
   personal data**. Pick a date range. The app emails a `.zip`.
2. Preview the import without writing:

   ```bash
   curl -X POST "http://localhost:5000/api/health/import-samsung?tz_offset_minutes=420" \
        --data-binary @samsung_health_export.zip \
        -H "Content-Type: application/zip"
   ```

   Returns a per-day preview plus the file list and totals. Use
   `tz_offset_minutes=420` for ICT/Vietnam (UTC+7), `-300` for EST,
   `0` for UTC.
3. Confirm and write to the database:

   ```bash
   curl -X POST "http://localhost:5000/api/health/import-samsung?tz_offset_minutes=420&confirm=true" \
        --data-binary @samsung_health_export.zip \
        -H "Content-Type: application/zip"
   ```

   Returns the same summary plus a `written`/`skipped` count.

**Storage:**

- `HealthEntry` (one row per day): steps, weight, water, sleep hours,
  workout minutes, calories in/out. The importer **fills gaps** but
  never overwrites values you've entered manually.
- `HeartRateSample` (one row per reading, many per day): for the
  heart-rate chart and any future HRV / resting-HR analysis.
- `SleepSession` (one row per sleep period): with optional
  `stages_json` (awake/light/deep/rem) for detailed sleep analysis.

**Idempotency:** Re-importing the same zip is safe. Health entries are
matched by date; heart-rate and sleep rows are deduplicated by
(timestamp, bpm) and (start_time, end_time) respectively, tagged with
`source = "samsung_csv"`.

**Real-time sync (Health Connect):** For ongoing automatic sync from a
Samsung phone, see the [`samsung-sync/`](../samsung-sync/README.md)
Android companion app. It pulls from Health Connect and posts to
`/api/health/ingest` either on demand or every 15 minutes.

### Real-time Health Connect sync

The Android companion app (`../samsung-sync/`) provides real-time sync
without any manual exports. It reads from **Health Connect** (the
unified Android health store that Samsung Health writes to) and
POSTs the data to `/api/health/ingest` in a single batched request.

**Enable on the server:**

```bash
# Generate a token
python -c "import secrets; print(secrets.token_urlsafe(32))"
# -> e.g. "p9Xk3mQ2..."

# Set the token and bind to all interfaces (so the phone can reach
# the server over LAN)
INGEST_TOKEN='p9Xk3mQ2...' HOST=0.0.0.0 python wsgi.py
```

**Build the Android app, install on your phone, enter the server
URL and token, grant Health Connect permissions, tap Sync.** Full
build and configuration instructions are in
[`../samsung-sync/README.md`](../samsung-sync/README.md).

**What the endpoint accepts:**

```json
POST /api/health/ingest
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{
  "tz_offset_minutes": 420,
  "steps":      [{"start": "...", "end": "...", "count": 1500}],
  "heart_rate": [{"timestamp": "...", "bpm": 72}],
  "sleep":      [{"start": "...", "end": "..."}],
  "weight":     [{"timestamp": "...", "kg": 71.5}],
  "hydration":  [{"timestamp": "...", "liters": 0.25}],
  "exercise":   [{"start": "...", "end": "...", "type": "running",
                  "calories": 320, "distance_m": 5000}],
  "calories_out": [{"start": "...", "kcal": 50}],
  "nutrition":    [{"start": "...", "kcal": 700, "meal": "lunch"}]
}
```

All keys are optional. The server dedups per type and returns
`{"status": "ok", "written": {...}, "skipped": {...}}`.

**Disable:** unset `INGEST_TOKEN` and the endpoint returns 503.
The rest of OneLife is unaffected.

## Data & privacy

- All data is stored locally in `instance/onelife.db` (SQLite).
- Uploaded documents are saved in `uploads/`.
- No internet connection is required.
- To back up: copy `instance/onelife.db` and `uploads/`.

## Requirements

- Python 3.11+
- Flask 3, Flask-SQLAlchemy 3.1, Flask-Migrate 4 (see `requirements.txt`)
