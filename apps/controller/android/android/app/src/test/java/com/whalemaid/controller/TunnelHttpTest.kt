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
        val req = TunnelHttp.buildTunnelRequest("POST", "/api/session.list", headers, "{}".toByteArray())
        assertTrue(req.startsWith("POST /api/session.list HTTP/1.1\r\n"))
        assertTrue(req.contains("Host: ${TunnelHttp.HOST_AUTHORITY}\r\n"))
        assertTrue(req.contains("Origin: http://${TunnelHttp.HOST_AUTHORITY}\r\n"))
        assertTrue(req.contains("X-Custom: yes\r\n"))
        assertFalse(req.contains("evil.example.com"))
        assertFalse(req.contains("Upgrade: websocket"))
        assertFalse(req.contains("Connection: keep-alive"))
        assertTrue(req.contains("content-length: 2\r\n"))
        assertTrue(req.endsWith("Connection: close\r\n\r\n"))
    }

    @Test
    fun buildTunnelRequestOmitsContentLengthWithoutBody() {
        val req = TunnelHttp.buildTunnelRequest("GET", "/", mapOf("Accept" to "*/*"), null)
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
        val req = TunnelHttp.buildEventsUpgradeRequest("/api/events.host?x=1", "dGhlIHNhbXBsZSBub25jZQ==")
        assertTrue(req.startsWith("GET /api/events.host?x=1 HTTP/1.1\r\n"))
        assertTrue(req.contains("Host: ${TunnelHttp.HOST_AUTHORITY}\r\n"))
        assertTrue(req.contains("Upgrade: websocket\r\n"))
        assertTrue(req.contains("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"))
    }

    @Test
    fun buildEventsUpgradeRequestSupportsMuxChannel() {
        val req = TunnelHttp.buildEventsUpgradeRequest("/api/events.mux", "")
        assertTrue(req.startsWith("GET /api/events.mux HTTP/1.1\r\n"))
    }
}
