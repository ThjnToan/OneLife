package com.onelife.sync

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.SleepStageRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Length
import androidx.health.connect.client.units.Mass
import androidx.health.connect.client.units.Volume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime

/**
 * Reads from Health Connect and posts the data to the OneLife server.
 *
 * Each record type is fetched in a window [startMs, now] and bundled
 * into a single JSON body that matches the server's
 * ``/api/health/ingest`` schema. The server handles per-type dedup,
 * so re-running this is safe.
 */
class HealthSync(private val context: Context) {

    private val client = HealthConnectClient.getOrCreate(context)

    /**
     * @return a [Result] with a short summary on success, or an
     *         exception on failure.
     */
    suspend fun runOnce(
        config: Config,
        sinceEpochMs: Long = 0L
    ): Result<SyncSummary> = withContext(Dispatchers.IO) {
        require(config.isConfigured()) {
            "Config not set: enter the OneLife URL and token first"
        }

        val now = Instant.now()
        val since = Instant.ofEpochMilli(if (sinceEpochMs > 0) sinceEpochMs else now.toEpochMilli() - 24L * 3600_000)
        val tzOffsetMin = ZoneId.systemDefault().rules.getOffset(now).totalSeconds / 60
        val filter = TimeRangeFilter.between(since, now)

        val body = JSONObject().apply {
            put("tz_offset_minutes", tzOffsetMin)
            put("steps", stepsToJson(filter))
            put("heart_rate", heartRateToJson(filter))
            put("sleep", sleepToJson(filter))
            put("weight", weightToJson(filter))
            put("hydration", hydrationToJson(filter))
            put("exercise", exerciseToJson(filter))
            put("calories_out", caloriesOutToJson(filter))
            put("nutrition", nutritionToJson(filter))
        }

        val response = postJson(config, "/api/health/ingest", body)
        val summary = SyncSummary(
            sent = body.toString().length,
            response = response.optString("status", "?"),
            written = response.optJSONObject("written")?.toString() ?: "{}",
            skipped = response.optJSONObject("skipped")?.toString() ?: "{}"
        )
        if (response.optString("status") == "ok") {
            config.lastSyncEpochMs = now.toEpochMilli()
        }
        Result.success(summary)
    }

    /** Returns the Android-side permissions needed for the records we read. */
    val requiredPermissions: Set<String>
        get() = setOf(
            "android.permission.health.READ_STEPS",
            "android.permission.health.READ_HEART_RATE",
            "android.permission.health.READ_SLEEP",
            "android.permission.health.READ_SLEEP_STAGE",
            "android.permission.health.READ_WEIGHT",
            "android.permission.health.READ_HYDRATION",
            "android.permission.health.READ_EXERCISE",
            "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
            "android.permission.health.READ_TOTAL_CALORIES_BURNED",
            "android.permission.health.READ_NUTRITION",
        )

    suspend fun hasAllPermissions(): Boolean {
        val granted = client.permissionController.getGrantedPermissions()
        return granted.containsAll(requiredPermissions)
    }

    suspend fun hasAnyPermission(): Boolean =
        client.permissionController.getGrantedPermissions().isNotEmpty()

    suspend fun permissionGrantedCount(): Int =
        client.permissionController.getGrantedPermissions().size

    // ----------------------- Per-type readers -----------------------

    private suspend fun stepsToJson(filter: TimeRangeFilter): JSONArray {
        val resp = client.readRecords(
            ReadRecordsRequest(recordType = StepsRecord::class, timeRangeFilter = filter)
        )
        val arr = JSONArray()
        for (r in resp.records) {
            arr.put(JSONObject().apply {
                put("start", r.startTime.toString())
                put("end", r.endTime.toString())
                put("count", r.count)
            })
        }
        return arr
    }

    private suspend fun heartRateToJson(filter: TimeRangeFilter): JSONArray {
        val resp = client.readRecords(
            ReadRecordsRequest(recordType = HeartRateRecord::class, timeRangeFilter = filter)
        )
        val arr = JSONArray()
        for (r in resp.records) {
            // Each HeartRateRecord has one or more samples
            for (s in r.samples) {
                arr.put(JSONObject().apply {
                    put("timestamp", s.time.toString())
                    put("bpm", s.beatsPerMinute)
                })
            }
        }
        return arr
    }

    private suspend fun sleepToJson(filter: TimeRangeFilter): JSONArray {
        val sessions = client.readRecords(
            ReadRecordsRequest(recordType = SleepSessionRecord::class, timeRangeFilter = filter)
        )
        val stagesResp = try {
            client.readRecords(
                ReadRecordsRequest(recordType = SleepStageRecord::class, timeRangeFilter = filter)
            )
        } catch (e: Exception) {
            Log.w(TAG, "Sleep stages unavailable: ${e.message}")
            null
        }
        val arr = JSONArray()
        for (r in sessions.records) {
            // Pair stages that fall within this session's window. A
            // stage record's start/end are in the same instant space
            // as the session, so an in-range check is sufficient.
            val stagesArr = JSONArray()
            stagesResp?.records
                ?.filter { !it.endTime.isBefore(r.startTime) && !it.startTime.isAfter(r.endTime) }
                ?.forEach { st ->
                    stagesArr.put(JSONObject().apply {
                        put("stage", sleepStageName(st.stage))
                        put("start", st.startTime.toString())
                        put("end", st.endTime.toString())
                    })
                }
            arr.put(JSONObject().apply {
                put("start", r.startTime.toString())
                put("end", r.endTime.toString())
                if (stagesArr.length() > 0) {
                    put("stages", stagesArr)
                }
            })
        }
        return arr
    }

    private fun sleepStageName(stage: Int): String = when (stage) {
        SleepStageRecord.STAGE_TYPE_AWAKE -> "awake"
        SleepStageRecord.STAGE_TYPE_SLEEPING -> "light"
        SleepStageRecord.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
        SleepStageRecord.STAGE_TYPE_LIGHT -> "light"
        SleepStageRecord.STAGE_TYPE_DEEP -> "deep"
        SleepStageRecord.STAGE_TYPE_REM -> "rem"
        else -> "unknown_$stage"
    }

    private suspend fun weightToJson(filter: TimeRangeFilter): JSONArray {
        val resp = client.readRecords(
            ReadRecordsRequest(recordType = WeightRecord::class, timeRangeFilter = filter)
        )
        val arr = JSONArray()
        for (r in resp.records) {
            arr.put(JSONObject().apply {
                put("timestamp", r.time.toString())
                put("kg", r.weight.inKilograms)
            })
        }
        return arr
    }

    private suspend fun hydrationToJson(filter: TimeRangeFilter): JSONArray {
        val resp = client.readRecords(
            ReadRecordsRequest(recordType = HydrationRecord::class, timeRangeFilter = filter)
        )
        val arr = JSONArray()
        for (r in resp.records) {
            arr.put(JSONObject().apply {
                put("timestamp", r.startTime.toString())
                put("liters", r.volume.inLiters)
            })
        }
        return arr
    }

    private suspend fun exerciseToJson(filter: TimeRangeFilter): JSONArray {
        val resp = client.readRecords(
            ReadRecordsRequest(recordType = ExerciseSessionRecord::class, timeRangeFilter = filter)
        )
        val arr = JSONArray()
        for (r in resp.records) {
            val typeName = exerciseTypeName(r.exerciseType)
            // Best-effort: fetch distance + calories for the session window
            val calories = readActiveCaloriesInWindow(r.startTime, r.endTime)
            val distance = readDistanceInWindow(r.startTime, r.endTime)
            arr.put(JSONObject().apply {
                put("start", r.startTime.toString())
                put("end", r.endTime.toString())
                put("type", typeName)
                put("calories", calories)
                put("distance_m", distance)
            })
        }
        return arr
    }

    private suspend fun readActiveCaloriesInWindow(
        start: Instant, end: Instant
    ): Double {
        return try {
            val resp = client.readRecords(
                ReadRecordsRequest(
                    recordType = ActiveCaloriesBurnedRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(start, end)
                )
            )
            resp.records.sumOf { it.energy.inKilocalories }
        } catch (e: Exception) { 0.0 }
    }

    private suspend fun readDistanceInWindow(
        start: Instant, end: Instant
    ): Double {
        return try {
            val resp = client.readRecords(
                ReadRecordsRequest(
                    recordType = DistanceRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(start, end)
                )
            )
            resp.records.sumOf { it.distance.inMeters }
        } catch (e: Exception) { 0.0 }
    }

    private suspend fun caloriesOutToJson(filter: TimeRangeFilter): JSONArray {
        // Sum Active + BMR-equivalent (Total) per-bucket
        val active = client.readRecords(
            ReadRecordsRequest(recordType = ActiveCaloriesBurnedRecord::class, timeRangeFilter = filter)
        )
        val arr = JSONArray()
        for (r in active.records) {
            arr.put(JSONObject().apply {
                put("start", r.startTime.toString())
                put("end", r.endTime.toString())
                put("kcal", r.energy.inKilocalories)
            })
        }
        return arr
    }

    private suspend fun nutritionToJson(filter: TimeRangeFilter): JSONArray {
        val resp = client.readRecords(
            ReadRecordsRequest(recordType = NutritionRecord::class, timeRangeFilter = filter)
        )
        val arr = JSONArray()
        for (r in resp.records) {
            arr.put(JSONObject().apply {
                put("start", r.startTime.toString())
                put("end", r.endTime.toString())
                put("kcal", r.energy?.inKilocalories ?: 0.0)
                // HC has no canonical meal type; derive from hour
                put("meal", mealFromHour(r.startTime))
            })
        }
        return arr
    }

    // ----------------------- Helpers -----------------------

    private fun postJson(config: Config, path: String, body: JSONObject): JSONObject {
        val url = URL(config.baseUrl.trimEnd('/') + path)
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Authorization", "Bearer ${config.token}")
        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() } ?: ""
        conn.disconnect()
        if (code !in 200..299) {
            throw RuntimeException("HTTP $code: $text")
        }
        return JSONObject(text)
    }

    private fun exerciseTypeName(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "running"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "walking"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "biking"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "swimming"
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "weightlifting"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "yoga"
        else -> "exercise_$type"
    }

    private fun mealFromHour(instant: Instant): String {
        val hour = instant.atZone(ZoneOffset.UTC).hour
        return when (hour) {
            in 5..10 -> "breakfast"
            in 11..14 -> "lunch"
            in 17..21 -> "dinner"
            else -> "snack"
        }
    }

    data class SyncSummary(
        val sent: Int,
        val response: String,
        val written: String,
        val skipped: String
    )

    companion object {
        private const val TAG = "OneLifeSync"
    }
}
