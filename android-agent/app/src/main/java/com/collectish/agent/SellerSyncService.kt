package com.collectish.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import kotlin.math.abs

class SellerSyncService : Service() {
    companion object {
        private const val SYNC_CHANNEL_ID = "collectish_seller_sync"
        private const val ALERT_CHANNEL_ID = "collectish_alerts"
        private const val SYNC_NOTIFICATION_ID = 2601
        private const val ALERT_POLL_MS = 10 * 60 * 1000L
    }

    private val api = NativeSupabase()
    private lateinit var alertThread: HandlerThread
    private lateinit var alertHandler: Handler

    private val alertPoll = object : Runnable {
        override fun run() {
            runCatching { pollAlerts() }
            alertHandler.postDelayed(this, ALERT_POLL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannels()
        startForeground(SYNC_NOTIFICATION_ID, syncNotification())
        alertThread = HandlerThread("collectish-alerts").apply { start() }
        alertHandler = Handler(alertThread.looper)
        alertHandler.postDelayed(alertPoll, 20_000L)
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(
                SYNC_CHANNEL_ID,
                "Collectish Seller Sync",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps authenticated Seller history syncing while Collectish is in the background."
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(
                ALERT_CHANNEL_ID,
                "Collectish Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Operational issues and important Collectish business alerts."
                enableVibration(true)
                setShowBadge(true)
            }
        )
    }

    private fun syncNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, SYNC_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Collectish Seller sync")
            .setContentText("Keeping Seller history current")
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    private fun pollAlerts() {
        val nativePrefs = getSharedPreferences("collectish-native", MODE_PRIVATE)
        val token = nativePrefs.getString("accessToken", null).orEmpty()
        if (token.isBlank()) return
        val rows = api.get(
            token,
            "collectish_alerts?select=id,alert_key,category,severity,title,message,action_screen,occurrence&resolved_at=is.null&order=last_seen_at.desc&limit=20"
        )
        val seen = getSharedPreferences("collectish-alerts", MODE_PRIVATE)
        val editor = seen.edit()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val id = row.optString("id")
            if (id.isBlank()) continue
            val occurrence = row.optInt("occurrence", 1).coerceAtLeast(1)
            val key = "seen:$id"
            if (seen.getInt(key, 0) >= occurrence) continue
            postAlert(row, id)
            editor.putInt(key, occurrence)
        }
        editor.apply()
    }

    private fun postAlert(row: org.json.JSONObject, id: String) {
        val screen = row.optString("action_screen", "admin").ifBlank { "admin" }
        val category = row.optString("category", "operational")
        val severity = row.optString("severity", "warning")
        val intent = Intent(this, AlertLandingActivity::class.java).putExtra("screen", screen)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val pending = PendingIntent.getActivity(this, abs(id.hashCode()), intent, flags)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, ALERT_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        val icon = if (category == "operational") android.R.drawable.stat_sys_warning else android.R.drawable.stat_notify_more
        val notification = builder
            .setSmallIcon(icon)
            .setContentTitle(row.optString("title", "Collectish alert"))
            .setContentText(row.optString("message", "Open Collectish for details."))
            .setStyle(Notification.BigTextStyle().bigText(row.optString("message", "Open Collectish for details.")))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setCategory(if (category == "business") Notification.CATEGORY_MESSAGE else Notification.CATEGORY_ERROR)
            .setPriority(if (severity == "critical") Notification.PRIORITY_HIGH else Notification.PRIORITY_DEFAULT)
            .build()
        getSystemService(NotificationManager::class.java).notify(3000 + abs(id.hashCode() % 100000), notification)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        if (::alertHandler.isInitialized) alertHandler.removeCallbacksAndMessages(null)
        if (::alertThread.isInitialized) alertThread.quitSafely()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
