package com.onelife.sync

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.lifecycle.lifecycleScope
import com.onelife.sync.databinding.ActivityMainBinding
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    companion object {
        private const val HC_PACKAGE = "com.google.android.apps.healthdata"
    }


    private lateinit var binding: ActivityMainBinding
    private lateinit var config: Config
    private lateinit var sync: HealthSync

    private val permLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        val allGranted = granted.containsAll(sync.requiredPermissions)
        binding.statusText.text =
            if (allGranted) "Permissions granted. Ready to sync."
            else "Some permissions denied. Tap 'Grant Health Connect access' again."
        binding.syncButton.isEnabled = allGranted && config.isConfigured()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        config = Config(this)
        sync = HealthSync(this)

        binding.urlInput.inputType = InputType.TYPE_TEXT_VARIATION_URI
        binding.tokenInput.inputType = InputType.TYPE_CLASS_TEXT or
            InputType.TYPE_TEXT_VARIATION_PASSWORD

        binding.urlInput.setText(config.baseUrl)
        binding.tokenInput.setText(config.token)

        binding.saveButton.setOnClickListener { save() }
        binding.grantButton.setOnClickListener { requestPermissions() }
        binding.syncButton.setOnClickListener { runSync() }
        binding.bgSyncSwitch.isChecked = config.backgroundSyncEnabled
        binding.bgSyncSwitch.setOnCheckedChangeListener { _, checked ->
            config.backgroundSyncEnabled = checked
            if (checked) {
                SyncWorker.schedule(this)
                toast("Background sync enabled (every 15 min)")
            } else {
                SyncWorker.cancel(this)
                toast("Background sync disabled")
            }
        }
        binding.testButton.setOnClickListener { testConnection() }
        binding.openHealthConnectButton.setOnClickListener { openHealthConnect() }

        updateLastSyncLabel()
    }

    override fun onResume() {
        super.onResume()
        lifecycleScope.launch { refreshStatus() }
    }

    private suspend fun refreshStatus() {
        try {
            val sdkStatus = HealthConnectClient.getSdkStatus(this)
            val hcPkg = detectHealthConnectPackage()
            val grantedCount = if (sdkStatus == HealthConnectClient.SDK_AVAILABLE)
                sync.permissionGrantedCount() else -1
            val pkgLine = if (hcPkg != null) "HC pkg: $hcPkg\n" else "HC pkg: NOT FOUND\n"

            val state = computeState(sdkStatus, grantedCount)
            binding.statusText.text = pkgLine + state.message
            binding.syncButton.isEnabled = state.canSync && config.isConfigured()
        } catch (e: Throwable) {
            android.util.Log.e("OneLifeSync", "permission check failed: ${e.message}", e)
            binding.statusText.text = "Health Connect error: ${e.message}"
        }
    }

    private sealed class StatusState(val message: String, val canSync: Boolean) {
        class HcUnavailable(sdkStatus: Int) : StatusState(
            "Health Connect not available (status=$sdkStatus). Install it from Play Store.",
            canSync = false,
        )
        class AllGranted(val count: Int) : StatusState(
            "All $count permissions granted. Ready to sync.",
            canSync = true,
        )
        class PartialPermissions(val granted: Int, val total: Int) : StatusState(
            "Permissions: $granted of $total granted. Tap 'Open Health Connect' to add the rest.",
            canSync = false,
        )
        class HcInstalledNotLinked : StatusState(
            "HC is installed. If OneLife Sync isn't in 'See more health apps' in Health Connect, force-stop HC and reopen this app.",
            canSync = false,
        )
        class NeedsConfig : StatusState(
            "Enter URL and token, tap Save, then 'Open Health Connect'.",
            canSync = false,
        )
    }

    private fun computeState(sdkStatus: Int, grantedCount: Int): StatusState {
        if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
            return StatusState.HcUnavailable(sdkStatus)
        }
        val total = sync.requiredPermissions.size
        return when {
            grantedCount == total -> StatusState.AllGranted(grantedCount)
            grantedCount > 0 -> StatusState.PartialPermissions(grantedCount, total)
            config.isConfigured() -> StatusState.HcInstalledNotLinked()
            else -> StatusState.NeedsConfig()
        }
    }

    private fun detectHealthConnectPackage(): String? {
        // Try the standard Google Health Connect package first.
        val candidates = listOf(
            "com.google.android.apps.healthdata",
            "com.samsung.android.health.connect",
            "com.samsung.android.shealth"
        )
        for (pkg in candidates) {
            val launch = packageManager.getLaunchIntentForPackage(pkg)
            if (launch != null) return pkg
        }
        return null
    }

    private fun save() {
        val url = binding.urlInput.text.toString().trim()
        val token = binding.tokenInput.text.toString().trim()
        if (url.isEmpty() || token.isEmpty()) {
            binding.statusText.text = "URL and token are required"
            toast("URL and token are required")
            return
        }
        config.baseUrl = url
        config.token = token
        binding.statusText.text = "Saved. Tap 'Grant Health Connect access' next."
        toast("Saved")
        lifecycleScope.launch {
            binding.syncButton.isEnabled = sync.hasAllPermissions() && config.isConfigured()
        }
    }

    private fun requestPermissions() {
        if (!config.isConfigured()) {
            binding.statusText.text = "Save URL and token first."
            toast("Save URL and token first")
            return
        }
        binding.statusText.text =
            "Opening Health Connect...\n\nIn Health Connect:\n" +
            "  Menu (☰) or 'Data sources' tab\n" +
            "  → 'Apps and devices'\n" +
            "  → 'OneLife Sync'\n" +
            "  → turn on all 9 toggles\n\n" +
            "Then return here and tap 'Check permissions'."
        // Some Samsung HC builds ignore the permission-intent action
        // and just open the home screen, so we always launch the app
        // generically and rely on the user to navigate.
        try {
            val launch = packageManager.getLaunchIntentForPackage(HC_PACKAGE)
            if (launch != null) {
                startActivity(launch)
            } else {
                // Health Connect is missing — fall back to the system
                // app-info page so the user can at least see this app.
                openAppSettings()
                binding.statusText.text =
                    "Health Connect is not installed. Install it from the Play Store, then come back here."
            }
        } catch (e: Throwable) {
            android.util.Log.e("OneLifeSync", "open HC failed: ${e.message}", e)
            binding.statusText.text = "Failed to open Health Connect: ${e.message}"
        }
    }

    private fun openAppSettings() {
        try {
            val intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            startActivity(intent)
        } catch (e: Throwable) {
            toast("Could not open app settings: ${e.message}")
        }
    }

    private fun runSync() {
        executeSync(busyLabel = "Syncing...") { sum ->
            "Synced.\nWritten: ${sum.written}\nSkipped: ${sum.skipped}"
        }
    }

    private fun testConnection() {
        if (!config.isConfigured()) {
            toast("Save URL and token first")
            return
        }
        executeSync(busyLabel = "Testing...", busyButton = binding.testButton) { sum ->
            "Connection OK. Last server response:\n${sum.response}"
        }
    }

    private fun executeSync(
        busyLabel: String,
        busyButton: android.widget.Button? = null,
        successLabel: (HealthSync.SyncSummary) -> String,
    ) {
        (busyButton ?: binding.syncButton).isEnabled = false
        binding.statusText.text = busyLabel
        lifecycleScope.launch {
            val r = sync.runOnce(config, sinceEpochMs = 0L)
            r.fold(
                onSuccess = { sum ->
                    binding.statusText.text = successLabel(sum)
                    if (busyButton == null) updateLastSyncLabel()
                },
                onFailure = { e ->
                    binding.statusText.text = "Failed: ${e.message}"
                }
            )
            (busyButton ?: binding.syncButton).isEnabled =
                sync.hasAllPermissions() && config.isConfigured()
        }
    }

    private fun openHealthConnect() {
        // "Open Android app settings" — opens Settings > Apps > OneLife
        // Sync > Permissions. This is the system-level path that
        // always works; from there the user can grant any of the
        // Health Connect categories.
        try {
            val intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            startActivity(intent)
        } catch (e: Throwable) {
            toast("Could not open app settings: ${e.message}")
        }
    }

    private fun updateLastSyncLabel() {
        val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
        val ms = config.lastSyncEpochMs
        binding.lastSyncText.text = if (ms == 0L) "Never synced"
        else "Last sync: ${fmt.format(Date(ms))}"
    }

    private fun toast(s: String) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
    }
}
