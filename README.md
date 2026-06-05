# OneStop

A local-first personal life-management system, composed of two projects:

| Folder          | What it is                                                                |
|-----------------|---------------------------------------------------------------------------|
| `lifehub/`      | Flask + SQLite web app (tasks, health, finance, journal, …). Run on your PC. |
| `samsung-sync/` | Native Android companion app that pulls Health Connect data into `lifehub`. |

See each project's README for setup:

- [`lifehub/README.md`](lifehub/README.md)
- [`samsung-sync/README.md`](samsung-sync/README.md)

## Quick start

```bash
# 1. Start the server
cd lifehub
python wsgi.py             # or:  docker compose up -d

# 2. (Optional) install the Android companion from samsung-sync/
#    See samsung-sync/README.md for the build steps.
```

## Privacy

Everything is local. No cloud, no telemetry. The Android app talks to the
server over your LAN only, using a bearer token you generate yourself
(`make ingest-token` in `lifehub/`).

## Repository layout

```
.
├── lifehub/                # Web app (Flask + SQLite)
│   ├── app/                #   Source
│   ├── tests/              #   pytest suite
│   ├── migrations/         #   Alembic
│   ├── static/             #   CSS, JS, manifest, service worker
│   ├── templates/          #   index.html
│   └── …
├── samsung-sync/           # Android companion (Kotlin)
│   └── app/src/main/java/com/onelife/sync/…
└── tools/                  # Offline Android build SDK / Gradle / JDK zips
```

`tools/`, the Samsung Health data dumps, and any built APK are git-ignored.
Don't commit real health data; use `lifehub/tests/fixtures/samsung_sample.zip`
for tests.
