package com.onelife.sync

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Periodic background sync via WorkManager.
 *
 * Schedule with [schedule]; the worker pulls the last 24h of data
 * (server's idempotent ingest endpoint will skip what was already
 * pushed). Runs at most once every 15 minutes (WorkManager minimum).
 */
class SyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val config = Config(applicationContext)
        if (!config.isConfigured()) {
            Log.w(TAG, "Skipping sync: not configured")
            return Result.success()  // not a failure
        }
        val sync = HealthSync(applicationContext)
        return try {
            val r = sync.runOnce(config, sinceEpochMs = config.lastSyncEpochMs)
            r.fold(
                onSuccess = { Log.i(TAG, "Sync ok: ${it.written}"); Result.success() },
                onFailure = { Log.e(TAG, "Sync failed", it); Result.retry() }
            )
        } catch (e: Exception) {
            Log.e(TAG, "Sync threw", e)
            Result.retry()
        }
    }

    companion object {
        const val WORK_NAME = "onelife_sync"
        private const val TAG = "SyncWorker"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}
