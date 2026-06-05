# Pairing the Samsung Health / Health Connect Android app

The Android companion app at `../samsung-sync/` POSTs batches of health
data to `/api/health/ingest`. The endpoint is gated by a shared bearer
token whose SHA-256 must be present in the server's `INGEST_TOKEN_SHA256`
config; the server derives that from the `INGEST_TOKEN` environment
variable at app-factory time.

## 1. Generate a token

```sh
make ingest-token
```

This prints something like:

```
# Generated on 2026-06-05T12:34:56+00:00
INGEST_TOKEN=AbC...32-chars-of-base64url
```

## 2. Put it in your env

Add the printed line to `.env` (or wherever you manage secrets). The
server must be restarted to pick up the new value.

## 3. Use it in the Android app

In `samsung-sync/app/src/main/java/com/onelife/sync/Config.kt`, set the
`INGEST_TOKEN` BuildConfig field (or runtime config) to the **raw**
token value. The Android app sends it as
`Authorization: Bearer <raw-token>`; the server hashes it and
compares in constant time.

## 4. Rotating

Re-run `make ingest-token` and update the server env and the Android
app. Old tokens stop working the moment the server restarts.

## Disabling

Unset `INGEST_TOKEN` (or set it to an empty string) and restart. The
ingest endpoint then returns `503` instead of processing data, so the
Android app can detect the feature is off.
