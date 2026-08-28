package com.collectish.agent

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Launcher boundary for the hosted Collectish shell.
 *
 * MainActivity historically persisted the entire hosted WebView through Android instance-state
 * restoration. That can resurrect an old failed DOM/module graph after the web deployment has
 * changed, bypassing the fresh cache-busted loadUrl() path entirely. Launch through a fresh task
 * so every explicit app launch creates a new MainActivity/WebView and therefore navigates to the
 * current production shell.
 */
class FreshBootActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        })
        finish()
    }
}
