package com.onelife.sync

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Persistent settings for the OneLife sync app.
 *
 * The token is the same one set on the server via the INGEST_TOKEN env
 * var; the server compares its SHA-256 against what the app sends in
 * the Authorization header. Because the token is a long-lived shared
 * secret, it lives in [EncryptedSharedPreferences] backed by an
 * AES-256 master key in the Android KeyStore. The base URL and
 * last-sync timestamp are not sensitive and stay in the regular
 * SharedPreferences file.
 */
class Config(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("onelife_sync", Context.MODE_PRIVATE)

    private val secretPrefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "onelife_sync_secret",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var baseUrl: String
        get() = prefs.getString(KEY_URL, "") ?: ""
        set(value) = prefs.edit().putString(KEY_URL, value).apply()

    var token: String
        get() = secretPrefs.getString(KEY_TOKEN, "") ?: ""
        set(value) = secretPrefs.edit().putString(KEY_TOKEN, value).apply()

    var lastSyncEpochMs: Long
        get() = prefs.getLong(KEY_LAST_SYNC, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_SYNC, value).apply()

    var backgroundSyncEnabled: Boolean
        get() = prefs.getBoolean(KEY_BG_SYNC, false)
        set(value) = prefs.edit().putBoolean(KEY_BG_SYNC, value).apply()

    fun isConfigured(): Boolean =
        baseUrl.isNotBlank() && token.isNotBlank()

    companion object {
        private const val KEY_URL = "base_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_LAST_SYNC = "last_sync_ms"
        private const val KEY_BG_SYNC = "bg_sync"
    }
}
