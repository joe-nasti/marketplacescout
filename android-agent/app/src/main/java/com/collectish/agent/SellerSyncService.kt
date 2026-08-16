package com.collectish.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder

class SellerSyncService : Service() {
    companion object {
        private const val CHANNEL_ID = "collectish_seller_sync"
        private const val NOTIFICATION_ID = 2601
    }

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Collectish Seller Sync",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "Keeps authenticated Seller history syncing while Collectish is in the background."
                    setShowBadge(false)
                }
            )
        }
        startForeground(NOTIFICATION_ID, notification())
    }

    private fun notification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
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

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
}
