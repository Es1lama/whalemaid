package com.whalemaid.controller

import java.io.ByteArrayOutputStream

/**
 * 隧道 HTTP 纯逻辑（无 Android 依赖，JVM 可测；SPEC: docs/protocol.md#PROTO-001/008）。
 * 由 WhaleMaidTunnelPlugin 的本地代理调用：路由决策、请求行构造、响应解析。
 */
object TunnelHttp {
    /** 受控端宿主 web 权威（隧道对端；官方信任栅栏按此权威放行） */
    const val HOST_AUTHORITY = "127.0.0.1:3181"
    const val CTRL_CONNECT_PATH = "/_ctrl/connect"

    enum class Route { MANAGEMENT, CONNECT, TUNNEL }

    /** 路由决策：POST /_ctrl/connect → 连接端点；未连接 GET / → 设备管理页；其余（含已连接 GET /）→ 隧道 */
    fun route(uri: String, method: String, connected: Boolean): Route = when {
        uri == CTRL_CONNECT_PATH && method == "POST" -> Route.CONNECT
        uri == "/" && method == "GET" && !connected -> Route.MANAGEMENT
        else -> Route.TUNNEL
    }

    /** 解码 HTTP/1.1 chunked 响应体（隧道上游常用）；截断/非法块安全中止 */
    fun decodeChunked(buf: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < buf.size) {
            val lineEnd = (i until buf.size).firstOrNull { buf[it] == '\r'.code.toByte() } ?: break
            val sizeStr = buf.copyOfRange(i, lineEnd).toString(Charsets.US_ASCII).trim()
            if (sizeStr.isEmpty()) break
            val size = sizeStr.toIntOrNull(16) ?: break
            if (size == 0) break
            val start = lineEnd + 2
            out.write(buf, start, size)
            i = start + size + 2
        }
        return out.toByteArray()
    }

    /** 解析隧道上游 HTTP 响应：无头体分隔符 → 502；头名小写；chunked 自动解码 */
    fun parseResponse(raw: ByteArray): Triple<Int, Map<String, String>, ByteArray> {
        val sep = indexOfCrlfCrlf(raw)
        if (sep < 0) return Triple(502, emptyMap(), raw)
        val head = raw.copyOfRange(0, sep).toString(Charsets.UTF_8)
        var body = raw.copyOfRange(sep + 4, raw.size)
        val lines = head.split("\r\n")
        val status = Regex("HTTP/1\\.1 (\\d+)").find(lines.firstOrNull() ?: "")?.groupValues?.get(1)?.toInt() ?: 502
        val headers = lines.drop(1).mapNotNull { l ->
            val idx = l.indexOf(':')
            if (idx < 0) null else l.substring(0, idx).trim().lowercase() to l.substring(idx + 1).trim()
        }.toMap()
        if (headers["transfer-encoding"] == "chunked") body = decodeChunked(body)
        return Triple(status, headers, body)
    }

    fun indexOfCrlfCrlf(buf: ByteArray): Int {
        for (i in 0 until buf.size - 3) {
            if (buf[i] == '\r'.code.toByte() && buf[i + 1] == '\n'.code.toByte() && buf[i + 2] == '\r'.code.toByte() && buf[i + 3] == '\n'.code.toByte()) return i
        }
        return -1
    }

    /** 浏览器请求 → 隧道内 HTTP 请求行：Host/Origin 改写宿主权威，hop 头剔除，有 body 补 content-length */
    fun buildTunnelRequest(method: String, uri: String, headers: Map<String, String>, bodyBytes: ByteArray?): String {
        val sb = StringBuilder()
        sb.append("$method $uri HTTP/1.1\r\n")
        sb.append("Host: $HOST_AUTHORITY\r\n")
        sb.append("Origin: http://$HOST_AUTHORITY\r\n")
        for ((k, v) in headers) {
            if (k.lowercase() in setOf("host", "connection", "content-length", "origin", "upgrade", "accept-encoding")) continue
            sb.append("$k: $v\r\n")
        }
        if (bodyBytes != null && bodyBytes.isNotEmpty()) sb.append("content-length: ${bodyBytes.size}\r\n")
        sb.append("Connection: close\r\n\r\n")
        return sb.toString()
    }

    /** 官方事件通道（/api/events.mux|host）的 WS upgrade 请求行——使用页面实际请求的 URI，不硬编码 */
    fun buildEventsUpgradeRequest(uri: String, secWebSocketKey: String): String =
        "GET $uri HTTP/1.1\r\nHost: $HOST_AUTHORITY\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: $secWebSocketKey\r\nSec-WebSocket-Version: 13\r\n\r\n"
}
