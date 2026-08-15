package com.collectish.agent

import android.net.Uri

/**
 * Safety policy for remotely-described read-only Seller Portal probes.
 */
object ReadOnlyProbePolicy {
    val allowedHosts = setOf(
        "sellerportal.tcgplayer.com",
        "store.tcgplayer.com",
        "order-management-api.tcgplayer.com",
        "sp-api.tcgplayer.com",
        "seller-settings-api.tcgplayer.com"
    )

    val allowedModes = setOf("navigate_capture", "fetch_json", "fetch_text")
    val allowedMethods = setOf("GET", "POST")

    private val readOnlyPostPaths = setOf(
        "/orders/search",
        "/orders/export"
    )

    private val allowedLegacyPrefixes = listOf(
        "/admin/RO",
        "/admin/ro",
        "/admin/payment/"
    )

    private val allowedSypGetPaths = setOf(
        "/admin/direct/GetLastUpdated",
        "/admin/direct/ExportSYPList"
    )

    fun isAllowedUrl(raw: String): Boolean = try {
        val uri = Uri.parse(raw)
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.host?.lowercase() in allowedHosts
    } catch (_: Exception) {
        false
    }

    fun isAllowedRequest(rawUrl: String, rawMethod: String): Boolean {
        if (!isAllowedUrl(rawUrl)) return false
        val uri = Uri.parse(rawUrl)
        val host = uri.host?.lowercase().orEmpty()
        val path = uri.path.orEmpty()
        val method = rawMethod.uppercase()
        if (method !in allowedMethods) return false

        if (method == "GET") {
            return when (host) {
                "order-management-api.tcgplayer.com" ->
                    path == "/orders/search" || path == "/orders/export" ||
                    path.startsWith("/orders/") || path == "/products/lines" ||
                    path == "/orders/actionable-count"
                "sp-api.tcgplayer.com" -> path.equals("/Account/auth-detail", true) || path.startsWith("/account/")
                "seller-settings-api.tcgplayer.com" -> path.startsWith("/v1/settings")
                "sellerportal.tcgplayer.com" -> path == "/orders" || path.startsWith("/orders/")
                "store.tcgplayer.com" -> allowedSypGetPaths.contains(path) || allowedLegacyPrefixes.any { path.startsWith(it) }
                else -> false
            }
        }

        return host == "order-management-api.tcgplayer.com" && path in readOnlyPostPaths
    }

    fun boundedWaitMs(value: Long): Long = value.coerceIn(250L, 10_000L)
    fun boundedBody(raw: String): String = raw.take(maxRequestBodyChars)

    const val maxRequestBodyChars = 100_000
    const val maxResponseChars = 5_000_000
    const val maxBodyChars = 200_000
    const val maxNetworkRequests = 160
}
