package com.collectish.agent

import android.net.Uri

/**
 * Safety policy for remotely-described read-only Seller Portal / Store probes.
 * Buyer account support is GET-only under /myaccount so the connector can read
 * order history, messages, store credit and other account-owned buyer surfaces.
 * No buyer-account or inventory mutations are allowlisted here.
 */
object ReadOnlyProbePolicy {
    val allowedHosts = setOf(
        "sellerportal.tcgplayer.com",
        "store.tcgplayer.com",
        "order-management-api.tcgplayer.com",
        "sp-api.tcgplayer.com",
        "seller-settings-api.tcgplayer.com"
    )

    val allowedModes = setOf("navigate_capture", "fetch_json", "fetch_text", "fetch_html")
    val allowedMethods = setOf("GET", "POST")

    private val orderReadOnlyPostPaths = setOf("/orders/search", "/orders/export")
    private val storeInventoryReadOnlyPostPaths = setOf("/admin/product/searchcatalog", "/admin/product/updateinstockquantities")
    private val allowedLegacyPrefixes = listOf("/admin/RO", "/admin/ro", "/admin/payment/")
    private val allowedSypGetPaths = setOf("/admin/direct/GetLastUpdated", "/admin/direct/ExportSYPList")

    fun isAllowedUrl(raw: String): Boolean = try {
        val uri = Uri.parse(raw)
        uri.scheme.equals("https", ignoreCase = true) && uri.host?.lowercase() in allowedHosts
    } catch (_: Exception) { false }

    fun isBuyerHistoryRequest(rawUrl: String): Boolean = try {
        val uri = Uri.parse(rawUrl)
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals("store.tcgplayer.com", ignoreCase = true) &&
            uri.path.orEmpty().lowercase().let { it == "/myaccount" || it.startsWith("/myaccount/") }
    } catch (_: Exception) { false }

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
                    path == "/orders/search" || path == "/orders/export" || path.startsWith("/orders/") || path == "/products/lines" || path == "/orders/actionable-count"
                "sp-api.tcgplayer.com" -> path.equals("/Account/auth-detail", true) || path.startsWith("/account/")
                "seller-settings-api.tcgplayer.com" -> path.startsWith("/v1/settings")
                "sellerportal.tcgplayer.com" -> path == "/orders" || path.startsWith("/orders/")
                "store.tcgplayer.com" ->
                    isBuyerHistoryRequest(rawUrl) || allowedSypGetPaths.contains(path) || allowedLegacyPrefixes.any { path.startsWith(it) } || path.startsWith("/admin/product/manage/")
                else -> false
            }
        }

        return when (host) {
            "order-management-api.tcgplayer.com" -> path in orderReadOnlyPostPaths
            "store.tcgplayer.com" -> path in storeInventoryReadOnlyPostPaths
            else -> false
        }
    }

    fun boundedWaitMs(value: Long): Long = value.coerceIn(250L, 10_000L)
    fun boundedBody(raw: String): String = raw.take(maxRequestBodyChars)

    const val maxRequestBodyChars = 100_000
    const val maxResponseChars = 5_000_000
    const val maxBodyChars = 200_000
    const val maxNetworkRequests = 160
}
