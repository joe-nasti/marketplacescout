package com.collectish.agent

import android.net.Uri

/**
 * Safety policy for remotely-described read-only probes.
 *
 * The remote job may choose an HTTPS URL and a capture mode, but it cannot
 * provide JavaScript, request bodies, mutation methods, or arbitrary hosts.
 */
object ReadOnlyProbePolicy {
    val allowedHosts = setOf(
        "sellerportal.tcgplayer.com",
        "store.tcgplayer.com",
        "order-management-api.tcgplayer.com",
        "sp-api.tcgplayer.com",
        "seller-settings-api.tcgplayer.com"
    )

    val allowedModes = setOf("navigate_capture", "fetch_get")

    fun isAllowedUrl(raw: String): Boolean = try {
        val uri = Uri.parse(raw)
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.host?.lowercase() in allowedHosts
    } catch (_: Exception) {
        false
    }

    fun boundedWaitMs(value: Long): Long = value.coerceIn(250L, 10_000L)
    const val maxBodyChars = 200_000
    const val maxNetworkRequests = 160
}
