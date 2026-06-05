# OneLife Sync — Samsung Health → OneLife (Android companion app)

A small Android app that reads from **Health Connect** (the unified
Android health store that Samsung Health writes to) and forwards the
data to your **OneLife** server's `/api/health/ingest` endpoint.

Covers: steps, heart rate, sleep sessions, weight, hydration,
exercise sessions, calories burned, and nutrition — all the metrics
the [Samsung Health CSV import](../lifehub/README.md#samsung-health-import)
also covers, but in real time instead of manual export.

## Prerequisites

1. **Phone with Android 8.0+ (API 26)** and the
   [Health Connect](https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata)
   app installed. (Samsung Health installed and signed in is recommended
   for actual data sources.)
2. **A running OneLife server** with `INGEST_TOKEN` set. See below.
3. **Android Studio Hedgehog (2023.1.1) or newer**, OR the Android SDK
   + JDK 17 + Gradle 8.7 for command-line builds.

## Server setup

On the machine running OneLife, generate a strong token and start the
server with it:

```bash
# Generate a token (any long random string)
python -c "import secrets; print(secrets.token_urlsafe(32))"
# -> e.g. "p9Xk3mQ2..."

# Restart OneLife with the token
INGEST_TOKEN='p9Xk3mQ2...' python wsgi.py
```

By default OneLife binds to `127.0.0.1:5000`. The phone needs to reach
it over the network, so either:

- **LAN access (recommended):** start with `HOST=0.0.0.0` and use
  the computer's LAN IP in the app (`http://192.168.1.10:5000`).
  Make sure your firewall allows inbound 5000.
- **USB:** plug in the phone, enable USB debugging, and run
  `adb reverse tcp:5000 tcp:5000`. Then use `http://localhost:5000`
  in the app.

## Build

### Option A — Android Studio (easiest)

1. Open Android Studio → **Open** → select the `samsung-sync/`
   directory.
2. Wait for Gradle sync to finish (downloads Health Connect SDK,
   etc.).
3. Connect your phone via USB (USB debugging on) and click **Run ▶**.

### Option B — Command line

```bash
cd samsung-sync
./gradlew assembleDebug
# APK is at: app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

> If `./gradlew` doesn't exist (only `gradle-wrapper.properties`
> does), bootstrap once with `gradle wrapper` (requires a system
> gradle install) or copy `gradlew` and `gradlew.bat` from another
> Android project.

## Configure the app

1. Open **OneLife Sync** on the phone.
2. **OneLife URL**: e.g. `http://192.168.1.10:5000` (no trailing
   slash). Use `http://10.0.2.2:5000` for the Android emulator.
3. **Bearer token**: the value of `INGEST_TOKEN` from the server.
4. Tap **Save**, then **Grant Health Connect access**. Approve all
   the requested permissions (steps, heart rate, sleep, etc.).
5. Tap **Test connection** to verify the phone can reach the server
   and the token is correct.
6. Tap **Sync now** to pull the last 24 h of data. Toggle
   **Background sync** for ongoing 15-minute syncs.

## What gets synced

| Health Connect record | OneLife storage | Per-day aggregation |
|---|---|---|
| `StepsRecord` | `HealthEntry.steps` | max of incoming vs. existing |
| `HeartRateRecord` | `HeartRateSample` | one row per sample |
| `SleepSessionRecord` | `SleepSession`, `HealthEntry.sleep_hours` | take longest session |
| `WeightRecord` | `HealthEntry.weight` | last reading of the day |
| `HydrationRecord` | `HealthEntry.water_liters` | sum per day |
| `ExerciseSessionRecord` (+ `Distance` + `ActiveCaloriesBurned`) | `HealthEntry.workout_minutes` | sum of session minutes |
| `ActiveCaloriesBurnedRecord` | `HealthEntry.calories_out` | sum per day |
| `NutritionRecord` | `HealthEntry.calories_in` | sum per day |

Re-syncing the same window is safe — the server dedups by
(timestamp, value) so the user can run "Sync now" any number of
times without creating duplicate rows. User-entered values in
`HealthEntry` are never overwritten; Health Connect data only
*fills gaps*.

## Troubleshooting

**"Connection failed" on Test connection**
- Check the phone can reach the server: open Chrome on the phone
  and visit `http://<your-ip>:5000/`. You should see the OneLife
  dashboard.
- Check `INGEST_TOKEN` is set on the server. If unset, the endpoint
  returns `503 Ingest endpoint disabled`.
- Check your firewall allows inbound 5000 on the server machine.

**Sync returns `401 Invalid token`**
- The token in the app doesn't match `INGEST_TOKEN` on the server.
  Re-copy both sides (no trailing whitespace).

**"Permissions denied"**
- Open Health Connect → Apps → OneLife Sync → Permissions and
  enable each data type. The **Grant Health Connect access**
  button in the app opens the system permission screen.

**Health Connect app is not installed**
- Install it from the Play Store link above. Some Samsung phones
  on older Android versions don't have it.

## Security notes

- The bearer token is stored in plain text in SharedPreferences
  (Android's standard per-app preference store). It is not exposed
  to other apps. If you uninstall the app, it's deleted.
- The server compares the SHA-256 of the presented token against
  `INGEST_TOKEN_SHA256`, so a config-file leak doesn't reveal the
  token directly. (It does reveal the hash, which is just as good
  for authentication — rotate `INGEST_TOKEN` to revoke.)
- Use `HOST=127.0.0.1` (the default) on the server when you don't
  need LAN access. The phone variant of "LAN access" via
  `HOST=0.0.0.0` is a deliberate opt-in.
