package com.collectish.agent

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class AlertLandingActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val screen = intent.getStringExtra("screen")?.lowercase()?.takeIf { it in setOf("scout","sealed","seller","syp","inventory","admin") } ?: "admin"
        getSharedPreferences("collectish-native", MODE_PRIVATE).edit().putString("lastPage", screen).apply()
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        finish()
    }
}
