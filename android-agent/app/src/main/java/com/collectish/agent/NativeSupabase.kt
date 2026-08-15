package com.collectish.agent

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class NativeSupabase {
    companion object {
        private const val BASE = "https://bnsnlikjeogzdubgyvxk.supabase.co"
        private const val KEY = "sb_publishable_Zl0XS3ueisENWcQAmQ0mwA_FIC4yje2"
    }

    data class Session(val accessToken: String, val refreshToken: String?, val email: String?)

    private fun connection(url: String, method: String = "GET", token: String? = null): HttpURLConnection {
        return (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 12000
            readTimeout = 20000
            setRequestProperty("apikey", KEY)
            setRequestProperty("Accept", "application/json")
            if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
        }
    }

    private fun body(conn: HttpURLConnection): String {
        val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
        return stream?.let { BufferedReader(InputStreamReader(it)).use { r -> r.readText() } }.orEmpty()
    }

    fun signIn(email: String, password: String): Session {
        val conn = connection("$BASE/auth/v1/token?grant_type=password", "POST").apply {
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        conn.outputStream.use { it.write(JSONObject().put("email", email).put("password", password).toString().toByteArray()) }
        val text = body(conn)
        if (conn.responseCode !in 200..299) throw IllegalStateException(JSONObject(text.ifBlank { "{}" }).optString("msg", "Sign in failed (${conn.responseCode})"))
        val json = JSONObject(text)
        return Session(json.getString("access_token"), json.optString("refresh_token").ifBlank { null }, json.optJSONObject("user")?.optString("email"))
    }

    fun refresh(refreshToken: String): Session {
        val conn = connection("$BASE/auth/v1/token?grant_type=refresh_token", "POST").apply {
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        conn.outputStream.use { it.write(JSONObject().put("refresh_token", refreshToken).toString().toByteArray()) }
        val text = body(conn)
        if (conn.responseCode !in 200..299) throw IllegalStateException("Session expired")
        val json = JSONObject(text)
        return Session(json.getString("access_token"), json.optString("refresh_token").ifBlank { refreshToken }, json.optJSONObject("user")?.optString("email"))
    }

    fun get(token: String, path: String): JSONArray {
        val conn = connection("$BASE/rest/v1/$path", "GET", token)
        val text = body(conn)
        if (conn.responseCode !in 200..299) throw IllegalStateException("Data request failed (${conn.responseCode})")
        return JSONArray(text)
    }

    fun getAll(token: String, path: String, pageSize: Int = 1000, maxRows: Int = 10000): JSONArray {
        val out = JSONArray()
        var from = 0
        val size = pageSize.coerceIn(100, 1000)
        while (from < maxRows) {
            val to = minOf(from + size - 1, maxRows - 1)
            val conn = connection("$BASE/rest/v1/$path", "GET", token).apply {
                setRequestProperty("Range", "$from-$to")
            }
            val text = body(conn)
            if (conn.responseCode !in 200..299) throw IllegalStateException("Data request failed (${conn.responseCode})")
            val page = JSONArray(text)
            for (i in 0 until page.length()) out.put(page.get(i))
            if (page.length() < size) break
            from += page.length()
        }
        return out
    }

    fun count(token: String, table: String, filter: String = ""): Int {
        val suffix = if (filter.isBlank()) "" else "?$filter"
        val conn = connection("$BASE/rest/v1/$table$suffix", "HEAD", token).apply {
            setRequestProperty("Prefer", "count=exact")
            setRequestProperty("Range", "0-0")
        }
        conn.responseCode
        val range = conn.getHeaderField("Content-Range").orEmpty()
        return range.substringAfter('/').toIntOrNull() ?: 0
    }

    fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}
