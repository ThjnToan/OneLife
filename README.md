# OneLife

A local-first personal life-management system. Tasks, projects, health data,
journal, contacts, learning, finance, goals, and document storage — all under
your control, on hardware you own.

```
┌──────────────────────┐   Health Connect   ┌────────────────────────┐
│  Android phone       │ ─────────────────▶ │  OneLife web app       │
│  (samsung-sync app)  │   over LAN         │  (Flask + SQLite)      │
└──────────────────────┘   bearer token     └────────────────────────┘
                                                    ▲
                                                    │ any browser on the LAN
                                                    │
                                              ┌────────────┐
                                              │  PC/laptop │
                                              └────────────┘
```

| Folder          | What it is                                                                                    |
|-----------------|-----------------------------------------------------------------------------------------------|
| `lifehub/`      | Flask + SQLite web app. The core product. Run it on a PC, Raspberry Pi, NAS, or a VM.        |
| `samsung-sync/` | Optional Android companion. Reads Health Connect (steps, heart rate, sleep, workouts, …) and pushes to `lifehub` over your LAN. |

Pick the install method that matches your host: **Docker** is recommended for
servers and NASes; **bare Python** is fine for desktops and laptops; **bare
Windows + auto-start** is the friendliest path on a home PC.

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
  - [Option A — Docker (Linux / NAS / Windows with WSL)](#option-a--docker-linux--nas--windows-with-wsl)
  - [Option B — Bare Python (Linux / macOS)](#option-b--bare-python-linux--macos)
  - [Option C — Bare Windows (desktop)](#option-c--bare-windows-desktop)
- [Reverse proxy and HTTPS](#reverse-proxy-and-https)
- [Android companion app](#android-companion-app-optional)
- [Backups](#backups)
- [Updating](#updating)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Privacy and security](#privacy-and-security)
- [License](#license)

---

## Features

- **Tasks and projects** — Kanban board, priorities, recurring tasks,
  streaks, subtasks, tags.
- **Health dashboard** — Steps, heart-rate samples, sleep sessions, weight,
  hydration, workouts, calories. Daily heatmap, 7-day sparklines, trend
  charts. Manual entries *and* automatic ingest from Health Connect.
- **Finance** — Accounts, transactions, budgets, recurring bills, assets and
  liabilities, net-worth over time, per-asset valuation history
  (back-datable to a specific day).
- **Goals, journal, learning, contacts, calendar, documents** — file
  uploads with type allow-list, full-text search across all sections.
- **Single user, single device** — there is no auth, no multi-tenant
  isolation, no cloud. The intended deployment is "one person, one box, on
  the LAN". Anything beyond that needs a reverse proxy and is your
  responsibility.
- **Import/export** — round-trip JSON export of the whole database
  (`/api/import`, `/api/export`) and a Samsung Health CSV importer
  (`/api/health/import-samsung`).

## Architecture

- **Backend** — Python 3.11+, Flask 3, SQLAlchemy 2, Flask-Migrate (Alembic),
  marshmallow for input validation, flask-limiter for rate-limiting,
  gunicorn in production.
- **Database** — SQLite by default (`lifehub/instance/onelife.db`). The
  schema is also compatible with PostgreSQL — set `DATABASE_URL` to a
  `postgresql+psycopg://…` URL to use it. SQLite is fine up to a few
  thousand rows per table; the hottest path is the dashboard's last-30-days
  query which is one `GROUP BY` on indexed columns.
- **Frontend** — Server-rendered HTML + a single-page app in
  `static/js/app.js`. No build step, no npm, no bundler. The whole static
  tree is around 100 KB and is served with `Cache-Control: max-age=3600,
  immutable` in production.
- **Health ingest** — `POST /api/health/ingest` accepts a JSON payload from
  the Android app. Hard-capped at 5 MB per request, bearer-token
  authenticated (constant-time SHA-256 compare on the server), dedups by
  `(source, timestamp, value)` before insert. Unknown fields in the
  payload are silently dropped so the app can ship new sections without
  breaking older servers.

---

## Quick start

### Option A — Docker (Linux / NAS / Windows with WSL)

This is the recommended path. The image is a slim Python 3.12 base, runs as
a non-root user, has a healthcheck, and persists data via bind mounts.

```bash
cd lifehub
cp .env.example .env             # then edit SECRET_KEY and INGEST_TOKEN
docker compose up -d --build
docker compose logs -f           # tail logs; Ctrl+C to detach
```

The server is on `http://<host>:5000`. SQLite and uploads live in
`lifehub/instance/` and `lifehub/uploads/` on the host.

Useful commands:

```bash
docker compose restart            # pick up a new .env
docker compose down               # stop
docker compose pull && docker compose up -d   # after a `git pull`
```

The image exposes a `HEALTHCHECK` that hits `/api/healthz` every 30 s. The
compose file's healthcheck hits the heavier `/api/dashboard/summary` — the
difference doesn't matter for self-hosting.

### Option B — Bare Python (Linux / macOS)

```bash
cd lifehub
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
$EDITOR .env                      # at minimum: set SECRET_KEY

# Initialize / migrate the database
flask --app manage db upgrade

# Production server (gunicorn)
gunicorn --bind 127.0.0.1:5000 --workers 2 --threads 4 wsgi:app

# OR, for development with auto-reload:
FLASK_ENV=development DEBUG=1 python wsgi.py
```

For a service that starts on boot, drop a systemd unit at
`/etc/systemd/system/onelife.service`:

```ini
[Unit]
Description=OneLife personal life-management
After=network.target

[Service]
Type=simple
User=onelife
WorkingDirectory=/opt/onelife/lifehub
EnvironmentFile=/opt/onelife/lifehub/.env
ExecStart=/opt/onelife/lifehub/.venv/bin/gunicorn --bind 127.0.0.1:5000 --workers 2 --threads 4 wsgi:app
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now onelife`.

### Option C — Bare Windows (desktop)

There is a launcher (`start.bat`) that starts the server, waits for port
5000, and opens Chrome in app mode. The `manage_startup.bat` script can
install a Windows-Startup-folder shortcut that runs the launcher at logon
with no visible console.

```bat
:: First time only:
cd lifehub
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
notepad .env                      :: set SECRET_KEY at minimum

:: Run the server + open the UI:
start.bat

:: Optional: install auto-start at logon:
manage_startup.bat
```

See `lifehub/AUTOSTART.txt` for the full description of what the auto-start
shortcut does.

---

## Reverse proxy and HTTPS

OneLife ships with no auth, binds to `127.0.0.1` by default, and assumes a
trusted LAN. If you want to expose it beyond that, **put a reverse proxy
in front** and never bind the app directly to a public interface.

The minimum sensible setup is Caddy or nginx with TLS, basic auth or SSO,
and a strict CORS policy. Example Caddyfile:

```caddyfile
onelife.example.com {
    basicauth {
        alice $2a$14$...   # caddy hash-password
    }
    reverse_proxy 127.0.0.1:5000
}
```

When fronted by a proxy, set `HOST=127.0.0.1` (default), and **do not set
`CORS_ORIGINS=*`**. Set it to your real origin instead, e.g.
`CORS_ORIGINS=https://onelife.example.com`.

`flask-limiter`'s storage defaults to `memory://`, which is per-process. If
you scale gunicorn workers or run multiple instances, set
`RATELIMIT_STORAGE_URL=redis://…` so the limit is shared.

---

## Android companion app (optional)

`samsung-sync/` is a small Android Kotlin app that reads from
[Health Connect](https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata)
and pushes to `/api/health/ingest` on your server over the LAN. It is
**optional** — the web app works fine without it. Install it if you want
real-time health data on top of the daily summaries you enter manually.

End-to-end setup:

1. **Generate a token on the server.**

   ```bash
   cd lifehub
   make ingest-token          # prints: INGEST_TOKEN=…
   ```

   Add the printed line to your `.env` and restart the server. If
   `INGEST_TOKEN` is empty, `/api/health/ingest` returns 503.

2. **Make the server reachable from the phone.** Easiest is
   `HOST=0.0.0.0` in `.env` and use the PC's LAN IP in the app
   (`http://192.168.1.10:5000`). For a USB-connected phone, run
   `adb reverse tcp:5000 tcp:5000` and use `http://localhost:5000` in
   the app instead. For an emulator, use `http://10.0.2.2:5000`.

3. **Build the APK.**

   - *Android Studio:* open `samsung-sync/`, let Gradle sync, click Run.
   - *Command line:* `cd samsung-sync && ./gradlew assembleDebug` →
     `app/build/outputs/apk/debug/app-debug.apk`, then
     `adb install -r app-debug.apk`.

4. **Configure on the phone:** open **OneLife Sync** → enter the URL
   (no trailing slash), paste the bearer token, tap **Save**, then
   **Grant Health Connect access**, then **Test connection**, then
   **Sync now**. Toggle **Background sync** for ongoing 15-minute
   syncs.

The token is stored in `EncryptedSharedPreferences` (AES-256-GCM, key
held in the Android Keystore). The URL and last-sync time are not
sensitive and live in the regular prefs file.

See [`samsung-sync/README.md`](samsung-sync/README.md) for the full
troubleshooting section and the per-record-type mapping table.

---

## Backups

The whole app state is two directories:

- `lifehub/instance/` — the SQLite database (`onelife.db`).
- `lifehub/uploads/` — uploaded documents, avatars, etc.

A backup is just a snapshot of both. SQLite is safe to back up live
(`VACUUM INTO` if you want a compacted copy, or just `cp`). The simplest
"good-enough" backup is a daily cron job that tars both directories.

```bash
# /etc/cron.daily/onelife-backup
tar -czf /backups/onelife-$(date +%F).tgz \
    -C /opt/onelife/lifehub instance uploads
```

Restore is the reverse: stop the server, untar, start the server. The
schema is versioned with Alembic, so the database will self-upgrade on
first start if the code is newer than the backup.

For belt-and-braces, run `GET /api/export` from any browser occasionally
and save the JSON somewhere safe. It is a complete, versioned dump of
every table and re-imports cleanly.

---

## Updating

```bash
# Docker:
cd lifehub
git pull
docker compose build && docker compose up -d

# Bare Python:
git pull
source .venv/bin/activate
pip install -r requirements.txt
flask --app manage db upgrade        # applies any pending Alembic migrations
systemctl restart onelife            # or however you supervise the process
```

Database migrations are forward-only and idempotent. Never edit a migration
file after it has been applied to a live database.

---

## Development

```bash
cd lifehub
make install        # pip install -r requirements.txt + dev tools
make test           # 124 tests, ~10 s
make lint           # ruff
make typecheck      # mypy
make run            # dev server with auto-reload
```

The `Makefile` also has `db-migrate msg="..."` to generate a new Alembic
migration after a model change, and `db-history` to inspect the chain.

Test fixtures live under `tests/fixtures/`. The included
`samsung_sample.zip` is synthetic — never commit a real
`samsunghealth_*.zip` export; the `.gitignore` will refuse it, and you
shouldn't try to bypass that.

---

## Troubleshooting

**`RuntimeError: SECRET_KEY must be set in production`**
You set `FLASK_ENV=production` (or didn't set it, in which case the
default is production) but didn't set `SECRET_KEY`. Either set it in
`.env` or run with `FLASK_ENV=development` for local hacking.

**`/api/health/ingest` returns `503 Ingest endpoint disabled`**
You didn't set `INGEST_TOKEN`. Generate one with `make ingest-token`,
add it to `.env`, and restart.

**Database is locked** (SQLite only)
Multiple writers at once can hit `database is locked`. Either reduce
concurrency (single gunicorn worker is fine for one user) or switch to
PostgreSQL via `DATABASE_URL=postgresql+psycopg://…`.

**Port 5000 already in use**
On macOS, `AirPlay Receiver` grabs 5000. Either disable it in
System Settings → AirDrop & Handoff, or run with `PORT=5050`.

**Phone can't reach the server**
- Same Wi-Fi network? Guest networks often isolate clients.
- Firewall: `sudo ufw allow 5000/tcp` (Linux), or open the port in
  Windows Defender Firewall.
- Try the URL in the phone's browser first; if it doesn't load, the
  network path is broken before auth matters.

**Tests fail with `IntegrityError` on duplicate (source, timestamp, bpm)**
That's the new dedup constraint working. If a test inserts the same
sample twice by accident, fix the test — don't disable the constraint.

---

## Privacy and security

- **No telemetry, no analytics, no third-party requests.** The app does
  not load any external scripts, fonts, or beacons. The only outbound
  HTTP requests it ever makes are responses to *your* browser.
- **No authentication by design.** This is a single-user LAN app. If
  you need multi-user, multi-device-across-the-internet, put it behind
  a reverse proxy with basic auth or SSO — see the
  [Reverse proxy and HTTPS](#reverse-proxy-and-https) section.
- **Bearer token for the ingest endpoint** is hashed (SHA-256) on the
  server. A config leak reveals the hash, not the token. Rotate by
  generating a new one and restarting.
- **CORS defaults to `*`** for development convenience. Set
  `CORS_ORIGINS=https://your.domain` in production.
- **Security headers** are emitted on every response:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin`.
- **Uploads are size-capped** (`MAX_CONTENT_LENGTH_MB`, default 50 MB)
  and extension-allow-listed (pdf, png, jpg, gif, doc, docx, txt, xls,
  xlsx, zip, mp3, mp4). The list is in `app/config.py`.

---

## Repository layout

```
.
├── lifehub/                     # The web app
│   ├── app/
│   │   ├── routes/              #   Flask blueprints (REST + page)
│   │   ├── schemas/             #   marshmallow input validators
│   │   ├── services/            #   Domain logic (assets, health, etc.)
│   │   ├── __init__.py          #   App factory
│   │   ├── config.py            #   Env-driven config
│   │   ├── extensions.py        #   db, migrate, limiter, cors
│   │   ├── models.py            #   SQLAlchemy models
│   │   └── utils.py             #   utcnow(), try_commit()
│   ├── tests/                   #   pytest (124 tests)
│   ├── migrations/              #   Alembic
│   ├── static/                  #   CSS, JS, manifest, service worker
│   ├── templates/               #   index.html (SPA shell)
│   ├── docs/                    #   INGEST_TOKEN.md
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── Makefile
│   ├── wsgi.py                  #   gunicorn entry
│   ├── manage.py                #   flask CLI entry
│   ├── pyproject.toml           #   ruff, mypy, pytest config
│   ├── requirements.txt
│   └── README.md                #   App-specific docs
│
├── samsung-sync/                # Android companion
│   └── app/src/main/java/com/onelife/sync/
│       ├── Config.kt            #   Encrypted token, regular prefs for URL
│       ├── HealthSync.kt        #   Health Connect client + payload build
│       ├── MainActivity.kt      #   UI + permission flow
│       └── SyncWorker.kt        #   WorkManager periodic sync
│
└── tools/                       # Offline Android SDK / Gradle / JDK
                                  # (gitignored, ~1.5 GB)
```

---

## License

TBD — pick a license that matches your intent. MIT and AGPL-3.0 are the
two common choices for self-hosted apps.
