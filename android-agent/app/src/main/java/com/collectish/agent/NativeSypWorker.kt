package com.collectish.agent

import android.content.Context
import android.webkit.CookieManager
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.time.Instant
import java.util.UUID

class NativeSypWorker(
    private val context: Context,
    private val api: NativeSupabase = NativeSupabase()
) {
    data class TickResult(
        val completed: Int,
        val sessionState: String,
        val detail: String
    )

    private data class ProbeResult(
        val success: Boolean,
        val authError: Boolean,
        val detail: String,
        val payload: JSONObject
    )

    companion object {
        private const val STORE_ORIGIN = "https://store.tcgplayer.com/"
        private const val LEASE_SECONDS = 300
        private const val MAX_JOBS_PER_TICK = 2
        private const val CONNECT_TIMEOUT_MS = 12_000
        private const val READ_TIMEOUT_MS = 45_000
    }

    fun tick(appVersion: String): TickResult {
        val token = sessionToken() ?: return TickResult(0, "signed_out", "Collectish session unavailable")
        val collectorId = collectorId()
        val cookie = CookieManager.getInstance().getCookie(STORE_ORIGIN).orEmpty()
        if (cookie.isBlank()) {
            heartbeat(token, collectorId, appVersion, "signed_out")
            return TickResult(0, "signed_out", "Waiting for authenticated TCGplayer Store session")
        }
        heartbeat(token, collectorId, appVersion, "authenticated")

        var completed = 0
        repeat(MAX_JOBS_PER_TICK) {
            val job = claim(token, collectorId) ?: return TickResult(completed, "authenticated", if (completed > 0) "SYP queue drained" else "SYP queue idle")
            val probeConfig = job.optJSONObject("payload_json")?.optJSONObject("probe") ?: JSONObject()
            val result = executeProbe(probeConfig)
            val finished = finish(token, collectorId, job.optString("job_id"), result)
            if (finished && result.success) completed++
            if (result.authError) {
                heartbeat(token, collectorId, appVersion, "signed_out")
                return TickResult(completed, "signed_out", result.detail)
            }
            if (!result.success) return TickResult(completed, "authenticated", result.detail)
        }
        return TickResult(completed, "authenticated", "Processed $completed native SYP job(s)")
    }

    private fun sessionToken(): String? {
        val prefs = context.getSharedPreferences("collectish-native", Context.MODE_PRIVATE)
        var access = prefs.getString("accessToken", null).orEmpty()
        val refresh = prefs.getString("refreshToken", null).orEmpty()
        if (access.isBlank() && refresh.isBlank()) return null
        if (access.isNotBlank()) return access
        return if (refresh.isNotBlank()) refreshSession(refresh) else null
    }

    fun refreshSessionIfNeeded(): String? {
        val prefs = context.getSharedPreferences("collectish-native", Context.MODE_PRIVATE)
        val refresh = prefs.getString("refreshToken", null).orEmpty()
        return if (refresh.isNotBlank()) refreshSession(refresh) else prefs.getString("accessToken", null)
    }

    private fun refreshSession(refresh: String): String? = runCatching {
        val session = api.refresh(refresh)
        context.getSharedPreferences("collectish-native", Context.MODE_PRIVATE).edit()
            .putString("accessToken", session.accessToken)
            .putString("refreshToken", session.refreshToken ?: refresh)
            .putString("email", session.email)
            .apply()
        session.accessToken
    }.getOrNull()

    private fun collectorId(): UUID {
        val prefs = context.getSharedPreferences("collectish-agent", Context.MODE_PRIVATE)
        val current = prefs.getString("collectorId", null)
        if (!current.isNullOrBlank()) return UUID.fromString(current)
        val created = UUID.randomUUID()
        prefs.edit().putString("collectorId", created.toString()).apply()
        return created
    }

    private fun heartbeat(token: String, collectorId: UUID, appVersion: String, state: String) {
        runCatching {
            api.rpcBoolean(token, "heartbeat_syp_collector", JSONObject()
                .put("p_collector_id", collectorId.toString())
                .put("p_app_version", appVersion)
                .put("p_session_state", state))
        }
    }

    private fun claim(token: String, collectorId: UUID): JSONObject? {
        val rows = try {
            api.rpcArray(token, "claim_syp_collector_job", JSONObject()
                .put("p_collector_id", collectorId.toString())
                .put("p_lease_seconds", LEASE_SECONDS))
        } catch (e: IllegalStateException) {
            if (e.message.orEmpty().contains("401")) {
                val refreshed = refreshSessionIfNeeded() ?: throw e
                return claim(refreshed, collectorId)
            }
            throw e
        }
        return if (rows.length() > 0) rows.optJSONObject(0) else null
    }

    private fun finish(token: String, collectorId: UUID, jobId: String, result: ProbeResult): Boolean {
        if (jobId.isBlank()) return false
        return try {
            api.rpcBoolean(token, "finish_syp_collector_job", JSONObject()
                .put("p_job_id", jobId)
                .put("p_collector_id", collectorId.toString())
                .put("p_success", result.success)
                .put("p_detail", result.detail)
                .put("p_probe", result.payload)
                .put("p_probe_state", if (result.success) "ready" else "error"))
        } catch (e: IllegalStateException) {
            if (e.message.orEmpty().contains("401")) {
                val refreshed = refreshSessionIfNeeded() ?: return false
                return api.rpcBoolean(refreshed, "finish_syp_collector_job", JSONObject()
                    .put("p_job_id", jobId)
                    .put("p_collector_id", collectorId.toString())
                    .put("p_success", result.success)
                    .put("p_detail", result.detail)
                    .put("p_probe", result.payload)
                    .put("p_probe_state", if (result.success) "ready" else "error"))
            }
            false
        }
    }

    private fun executeProbe(config: JSONObject): ProbeResult {
        val mode = config.optString("mode", "fetch_text")
        val method = config.optString("method", "GET").uppercase()
        val requestedUrl = config.optString("url", "")
        if (mode != "fetch_text" || !ReadOnlyProbePolicy.isSypReadOnlyGet(requestedUrl, method)) {
            return failure("Native SYP worker rejected a non-SYP or non-GET request", requestedUrl, false)
        }

        var currentUrl = requestedUrl
        repeat(4) { attemptIndex ->
            if (!ReadOnlyProbePolicy.isSypReadOnlyGet(currentUrl, "GET")) {
                return failure("TCGplayer Store session redirected outside the SYP read-only allowlist", currentUrl, true)
            }
            val started = System.currentTimeMillis()
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                instanceFollowRedirects = false
                setRequestProperty("Accept", "text/plain,text/csv,application/json,*/*;q=0.8")
                setRequestProperty("Cache-Control", "no-cache")
                CookieManager.getInstance().getCookie(currentUrl)?.takeIf { it.isNotBlank() }?.let { setRequestProperty("Cookie", it) }
            }
            try {
                val status = conn.responseCode
                persistResponseCookies(currentUrl, conn)
                if (status in 300..399) {
                    val location = conn.getHeaderField("Location").orEmpty()
                    if (location.isBlank()) return failure("TCGplayer returned HTTP $status without a redirect target", currentUrl, false)
                    currentUrl = URI(currentUrl).resolve(location).toString()
                    if (currentUrl.contains("login", true) || currentUrl.contains("signin", true)) {
                        return failure("TCGplayer Store session is not authenticated", currentUrl, true)
                    }
                    return@repeat
                }
                val body = readBounded(conn, status in 200..299)
                val loginBody = body.take(12_000).let { it.contains("sign in", true) || it.contains("log in", true) || it.contains("forgot password", true) }
                if (loginBody) return failure("TCGplayer Store session is not authenticated", currentUrl, true)
                if (status !in 200..299) return failure("TCGplayer returned HTTP $status", currentUrl, false, status, body.take(250))
                val payload = JSONObject()
                    .put("ok", true)
                    .put("status", status)
                    .put("statusText", conn.responseMessage ?: "OK")
                    .put("url", currentUrl)
                    .put("requestedUrl", requestedUrl)
                    .put("finalHost", URL(currentUrl).host)
                    .put("finalPath", URL(currentUrl).path)
                    .put("method", "GET")
                    .put("contentType", conn.contentType ?: "")
                    .put("elapsedMs", System.currentTimeMillis() - started)
                    .put("attempt", attemptIndex + 1)
                    .put("body", body)
                    .put("checkedAt", Instant.now().toString())
                return ProbeResult(true, false, "Authenticated native SYP read-only probe completed", payload)
            } catch (e: Exception) {
                return failure("Native SYP request failed: ${e.message ?: e.javaClass.simpleName}", currentUrl, false)
            } finally {
                conn.disconnect()
            }
        }
        return failure("TCGplayer SYP request exceeded redirect limit", currentUrl, false)
    }

    private fun persistResponseCookies(url: String, conn: HttpURLConnection) {
        val manager = CookieManager.getInstance()
        conn.headerFields.filterKeys { it?.equals("Set-Cookie", true) == true }.values.flatten().forEach { cookie ->
            runCatching { manager.setCookie(url, cookie) }
        }
        runCatching { manager.flush() }
    }

    private fun readBounded(conn: HttpURLConnection, success: Boolean): String {
        val stream = if (success) conn.inputStream else conn.errorStream ?: return ""
        val reader = BufferedReader(InputStreamReader(stream))
        val out = StringBuilder(minOf(65_536, ReadOnlyProbePolicy.maxResponseChars))
        val buffer = CharArray(16_384)
        reader.use {
            while (out.length < ReadOnlyProbePolicy.maxResponseChars) {
                val remaining = ReadOnlyProbePolicy.maxResponseChars - out.length
                val n = it.read(buffer, 0, minOf(buffer.size, remaining))
                if (n <= 0) break
                out.append(buffer, 0, n)
            }
        }
        return out.toString()
    }

    private fun failure(detail: String, url: String, authError: Boolean, status: Int? = null, body: String = ""): ProbeResult {
        val payload = JSONObject()
            .put("error", detail)
            .put("url", url)
            .put("method", "GET")
            .put("checkedAt", Instant.now().toString())
        if (status != null) payload.put("status", status)
        if (body.isNotBlank()) payload.put("body", body)
        return ProbeResult(false, authError, detail, payload)
    }
}
