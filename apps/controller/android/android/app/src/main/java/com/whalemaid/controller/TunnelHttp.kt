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
    const val CTRL_STATUS_PATH = "/_ctrl/status"

    enum class Route { MANAGEMENT, CONNECT, STATUS, TUNNEL }

    /** 路由决策：POST /_ctrl/connect → 连接端点；POST /_ctrl/status → 连接前在线状态查询；未连接 GET / → 设备管理页；其余 → 隧道 */
    fun route(uri: String, method: String, connected: Boolean): Route = when {
        uri == CTRL_CONNECT_PATH && method == "POST" -> Route.CONNECT
        uri == CTRL_STATUS_PATH && method == "POST" && !connected -> Route.STATUS
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

    /** 官方事件通道（/api/events.mux|host）的 WS upgrade 请求行——使用页面实际请求的 URI 与 Origin，不硬编码 */
    fun buildEventsUpgradeRequest(uri: String, secWebSocketKey: String, origin: String? = null): String {
        val originLine = if (origin.isNullOrEmpty()) "" else "Origin: $origin\r\n"
        return "GET $uri HTTP/1.1\r\nHost: $HOST_AUTHORITY\r\n$originLine" +
            "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: $secWebSocketKey\r\nSec-WebSocket-Version: 13\r\n\r\n"
    }

    /** 中继控制面端口 = server 串实际端口（TOFU 指纹必须从该端口捕获）；缺省 9080（部署默认） */
    fun controlPortOf(server: String): Int = server.substringAfter(":", "9080").substringBefore("/").toIntOrNull() ?: 9080

    /**
     * 上游 WS 字节流帧解析（server→client 无掩码）。事件桥用它把宿主的 WS 帧
     * 按原 opcode/fin/payload 重发（文本帧不能被降级成二进制帧——官方客户端只认 text）。
     * 数据不足返回 null（继续攒）；服务端帧带掩码 = 协议违例，抛异常。
     */
    object WsFrames {
        data class Frame(val fin: Boolean, val opcode: Int, val payload: ByteArray, val consumed: Int)

        fun tryParse(buf: ByteArray, offset: Int): Frame? {
            if (buf.size - offset < 2) return null
            val b0 = buf[offset].toInt() and 0xFF
            val b1 = buf[offset + 1].toInt() and 0xFF
            val fin = (b0 and 0x80) != 0
            val opcode = b0 and 0x0F
            val masked = (b1 and 0x80) != 0
            if (masked) throw IllegalArgumentException("服务端 WS 帧不应带掩码（协议违例）")
            var len = b1 and 0x7F
            var head = offset + 2
            if (len == 126) {
                if (buf.size - head < 2) return null
                len = ((buf[head].toInt() and 0xFF) shl 8) or (buf[head + 1].toInt() and 0xFF)
                head += 2
            } else if (len == 127) {
                if (buf.size - head < 8) return null
                var l = 0L
                for (i in 0 until 8) l = (l shl 8) or (buf[head + i].toLong() and 0xFF)
                if (l > Int.MAX_VALUE) throw IllegalArgumentException("WS 帧过长")
                len = l.toInt()
                head += 8
            }
            if (buf.size - head < len) return null
            val payload = buf.copyOfRange(head, head + len)
            return Frame(fin, opcode, payload, head + len - offset)
        }
    }
}
