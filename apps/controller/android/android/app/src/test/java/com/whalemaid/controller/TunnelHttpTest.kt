package com.whalemaid.controller

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TunnelHttp 纯逻辑冒烟（R1..R5，先红后绿）：
 * R1 未连接 GET / → 管理页；已连接 GET / → 隧道（官方 UI）
 * R2 / 与 /_ctrl/connect 之外全部路径 → 隧道
 * R3 隧道请求行：Host/Origin 改写宿主权威；hop 头剔除；有 body 补 content-length
 * R4 响应解析：chunked 解码（多块+终止块）、无分隔符 → 502、状态码/小写头
 * R5 WS upgrade 请求行使用页面实际 URI（events.mux / events.host）
 */
class TunnelHttpTest {

    // ---- R1/R2 路由决策 ----

    @Test
    fun routeManagementOnlyWhenDisconnectedRoot() {
        assertEquals(TunnelHttp.Route.MANAGEMENT, TunnelHttp.route("/", "GET", false))
        assertEquals(TunnelHttp.Route.TUNNEL, TunnelHttp.route("/", "GET", true))
    }

    @Test
    fun routeConnectEndpoint() {
        assertEquals(TunnelHttp.Route.CONNECT, TunnelHttp.route("/_ctrl/connect", "POST", false))
        assertEquals(TunnelHttp.Route.CONNECT, TunnelHttp.route("/_ctrl/connect", "POST", true))
    }

    @Test
    fun routeConnectEndpointOnlyForPost() {
        assertEquals(TunnelHttp.Route.TUNNEL, TunnelHttp.route("/_ctrl/connect", "GET", false))
    }

    @Test
    fun routeTunnelForEverythingElse() {
        assertEquals(TunnelHttp.Route.TUNNEL, TunnelHttp.route("/plugins/x.js", "GET", true))
        assertEquals(TunnelHttp.Route.TUNNEL, TunnelHttp.route("/api/session.list", "POST", true))
        assertEquals(TunnelHttp.Route.TUNNEL, TunnelHttp.route("/assets/app.css", "GET", false))
    }

    // ---- R3 隧道请求行 ----

    @Test
    fun buildTunnelRequestRewritesAuthorityAndDropsHopHeaders() {
        val headers = mapOf(
            "Host" to "evil.example.com",
            "Origin" to "http://evil.example.com",
            "Connection" to "keep-alive",
            "Content-Length" to "999",
            "Upgrade" to "websocket",
            "Accept-Encoding" to "gzip",
            "X-Custom" to "yes",
            "Content-Type" to "application/json",
        )
        val req = TunnelHttp.buildTunnelRequest("POST", "/api/session.list", headers, "{}".toByteArray(), "127.0.0.1:3182")
        assertTrue(req.startsWith("POST /api/session.list HTTP/1.1\r\n"))
        assertTrue(req.contains("Host: 127.0.0.1:3182\r\n"))
        assertTrue(req.contains("Origin: http://127.0.0.1:3182\r\n"))
        assertTrue(req.contains("X-Custom: yes\r\n"))
        assertFalse(req.contains("evil.example.com"))
        assertFalse(req.contains("Upgrade: websocket"))
        assertFalse(req.contains("Connection: keep-alive"))
        assertTrue(req.contains("content-length: 2\r\n"))
        assertTrue(req.endsWith("Connection: close\r\n\r\n"))
    }

    @Test
    fun buildTunnelRequestOmitsContentLengthWithoutBody() {
        val req = TunnelHttp.buildTunnelRequest("GET", "/", mapOf("Accept" to "*/*"), null, "127.0.0.1:3182")
        assertFalse(req.contains("content-length"))
        assertTrue(req.endsWith("Connection: close\r\n\r\n"))
    }

    // ---- R4 响应解析 ----

    @Test
    fun parseResponseDecodesChunkedMultiChunk() {
        val raw = ("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n" +
            "5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n").toByteArray()
        val (status, headers, body) = TunnelHttp.parseResponse(raw)
        assertEquals(200, status)
        assertEquals("text/html", headers["content-type"])
        assertEquals("chunked", headers["transfer-encoding"])
        assertArrayEquals("hello world".toByteArray(), body)
    }

    @Test
    fun parseResponsePassesThroughNonChunkedBody() {
        val raw = "HTTP/1.1 404 Not Found\r\nContent-Length: 3\r\n\r\nabc".toByteArray()
        val (status, headers, body) = TunnelHttp.parseResponse(raw)
        assertEquals(404, status)
        assertEquals("3", headers["content-length"])
        assertArrayEquals("abc".toByteArray(), body)
    }

    @Test
    fun parseResponseWithoutSeparatorYields502() {
        val (status, _, _) = TunnelHttp.parseResponse("HTTP/1.1 200 OK".toByteArray())
        assertEquals(502, status)
    }

    @Test
    fun parseResponseLowercasesHeaderNames() {
        val raw = "HTTP/1.1 200 OK\r\nX-UPPER: v\r\n\r\n".toByteArray()
        val (_, headers, _) = TunnelHttp.parseResponse(raw)
        assertTrue(headers.containsKey("x-upper"))
    }

    @Test
    fun decodeChunkedHandlesSingleChunk() {
        assertArrayEquals("abc".toByteArray(), TunnelHttp.decodeChunked("3\r\nabc\r\n0\r\n\r\n".toByteArray()))
    }

    // ---- R5 WS 事件升级请求行 ----

    @Test
    fun buildEventsUpgradeRequestUsesActualUri() {
        val req = TunnelHttp.buildEventsUpgradeRequest("/api/events.host?x=1", "dGhlIHNhbXBsZSBub25jZQ==", "127.0.0.1:3182")
        assertTrue(req.startsWith("GET /api/events.host?x=1 HTTP/1.1\r\n"))
        assertTrue(req.contains("Host: 127.0.0.1:3182\r\n"))
        assertTrue(req.contains("Origin: http://127.0.0.1:3182\r\n"))
        assertTrue(req.contains("Upgrade: websocket\r\n"))
        assertTrue(req.contains("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun buildEventsUpgradeRequestRejectsMissingAuthority() {
        TunnelHttp.buildEventsUpgradeRequest("/api/events.mux", "", "")
    }

    @Test
    fun buildEventsUpgradeRequestSupportsMuxChannel() {
        val req = TunnelHttp.buildEventsUpgradeRequest("/api/events.mux", "", "127.0.0.1:3182")
        assertTrue(req.startsWith("GET /api/events.mux HTTP/1.1\r\n"))
    }

    // ---- 状态码构造：任意数值都必须产出合法 IStatus（防 "Status can't be null" 崩溃） ----

    @Test
    fun nanoStatusNeverReturnsNull() {
        for (code in listOf(200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 416, 423, 429, 500, 501, 502, 503, 505)) {
            val s = NanoStatus.of(code)
            assertEquals(code, s.requestStatus)
        }
    }

    @Test
    fun nanoStatusDescriptionCarriesCode() {
        // NanoHTTPD 状态行 = "HTTP/1.1 " + getDescription()；描述必须自带状态码
        for (code in listOf(423, 429, 502, 504, 599)) {
            assertTrue(NanoStatus.of(code).description.startsWith("$code "))
        }
    }

    // ---- TOFU 捕获端口必须等于实际连接端口（默认 9080） ----

    @Test
    fun controlPortOfUsesActualPort() {
        assertEquals(9180, TunnelHttp.controlPortOf("127.0.0.1:9180"))
        assertEquals(9080, TunnelHttp.controlPortOf("relay.example.com"))
        assertEquals(9443, TunnelHttp.controlPortOf("relay.example.com:9443"))
        assertEquals(9080, TunnelHttp.controlPortOf("relay.example.com:notaport"))
    }

    // ---- 上游 WS 帧解析（server→client 无掩码；按原 opcode/fin 重发用） ----

    @Test
    fun wsFramesSingleTextFrame() {
        val f = TunnelHttp.WsFrames.tryParse(byteArrayOf(0x81.toByte(), 0x05, 'h'.code.toByte(), 'e'.code.toByte(), 'l'.code.toByte(), 'l'.code.toByte(), 'o'.code.toByte()), 0)!!
        assertEquals(true, f.fin)
        assertEquals(1, f.opcode)
        assertArrayEquals("hello".toByteArray(), f.payload)
        assertEquals(7, f.consumed)
    }

    @Test
    fun wsFramesBinaryAndPing() {
        val bin = TunnelHttp.WsFrames.tryParse(byteArrayOf(0x82.toByte(), 0x01, 0x2A), 0)!!
        assertEquals(2, bin.opcode)
        val ping = TunnelHttp.WsFrames.tryParse(byteArrayOf(0x89.toByte(), 0x00), 0)!!
        assertEquals(9, ping.opcode)
        assertEquals(2, ping.consumed)
    }

    @Test
    fun wsFramesExtendedLength16() {
        val buf = ByteArray(260)
        buf[0] = 0x81.toByte(); buf[1] = 0x7E; buf[2] = 0x01; buf[3] = 0x00
        val f = TunnelHttp.WsFrames.tryParse(buf, 0)!!
        assertEquals(256, f.payload.size)
        assertEquals(260, f.consumed)
    }

    @Test
    fun wsFramesFragmentedContinuation() {
        // fin=0 op=1 "he" | fin=1 op=0 "llo"
        val f1 = TunnelHttp.WsFrames.tryParse(byteArrayOf(0x01, 0x02, 'h'.code.toByte(), 'e'.code.toByte()), 0)!!
        assertEquals(false, f1.fin); assertEquals(1, f1.opcode)
        val f2 = TunnelHttp.WsFrames.tryParse(byteArrayOf(0x80.toByte(), 0x03, 'l'.code.toByte(), 'l'.code.toByte(), 'o'.code.toByte()), 0)!!
        assertEquals(true, f2.fin); assertEquals(0, f2.opcode)
    }

    @Test
    fun wsFramesIncompleteReturnsNull() {
        assertEquals(null, TunnelHttp.WsFrames.tryParse(byteArrayOf(0x81.toByte(), 0x05, 'h'.code.toByte()), 0))
    }
}
