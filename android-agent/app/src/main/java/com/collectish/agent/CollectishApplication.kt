package com.collectish.agent

import android.app.Activity
import android.app.Application
import android.os.Bundle

class CollectishApplication : Application(), Application.ActivityLifecycleCallbacks {
    private val prefsName = "collectish-native"
    private val validPages = setOf("scout", "seller", "syp", "admin")

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(this)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity !is MainActivity) return
        val prefs = getSharedPreferences(prefsName, MODE_PRIVATE)
        if (prefs.getString("accessToken", null).isNullOrBlank()) return
        val lastPage = prefs.getString("lastPage", null)?.takeIf(validPages::contains) ?: return
        runCatching {
            val method = MainActivity::class.java.getDeclaredMethod("showPage", String::class.java)
            method.isAccessible = true
            method.invoke(activity, lastPage)
        }
    }

    override fun onActivityPaused(activity: Activity) {
        if (activity !is MainActivity) return
        runCatching {
            val field = MainActivity::class.java.getDeclaredField("currentPage")
            field.isAccessible = true
            val page = field.get(activity) as? String
            if (page != null && page in validPages) {
                getSharedPreferences(prefsName, MODE_PRIVATE).edit().putString("lastPage", page).apply()
            }
        }
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}