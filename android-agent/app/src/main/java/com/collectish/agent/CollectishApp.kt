package com.collectish.agent

import android.Manifest
import android.app.Activity
import android.app.Application
import android.os.Build
import android.os.Bundle
import android.content.pm.PackageManager

class CollectishApp : Application(), Application.ActivityLifecycleCallbacks {
    private var asked = false

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(this)
    }

    override fun onActivityResumed(activity: Activity) {
        if (asked || Build.VERSION.SDK_INT < 33) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        asked = true
        activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2602)
    }

    override fun onActivityCreated(activity: Activity, state: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
}
