package com.collectish.agent

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.webkit.PermissionRequest

/** Bridges a hosted getUserMedia(audio) request to Android's runtime permission. */
class MicrophonePermissionDelegate(
    private val activity: Activity,
    private val requestCode: Int
) {
    private var pending: PermissionRequest? = null

    fun handle(request: PermissionRequest): Boolean {
        if (!request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) return false
        pending?.deny()
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            pending = request
            activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), requestCode)
        }
        return true
    }

    fun canceled(request: PermissionRequest) {
        if (pending === request) pending = null
    }

    fun result(code: Int, permissions: Array<out String>, results: IntArray): Boolean {
        if (code != requestCode) return false
        val granted = permissions.indices.any { index ->
            permissions[index] == Manifest.permission.RECORD_AUDIO &&
                results.getOrNull(index) == PackageManager.PERMISSION_GRANTED
        }
        pending?.let { request ->
            if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request.deny()
        }
        pending = null
        return true
    }

    fun cancel() {
        pending?.deny()
        pending = null
    }
}
