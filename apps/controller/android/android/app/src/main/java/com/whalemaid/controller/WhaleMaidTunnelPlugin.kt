package com.whalemaid.controller

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoWSD
import fi.iki.elonen.NanoWSD.WebSocketFrame.CloseCode
import okhttp3.CertificatePinner
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response as OkResponse
import okhttp3.WebSocket as OkWebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * WhaleMaid 主控端隧道代理（D-023/024 原生流量发送；不承载任何自研 UI/协议）：
 * - 本地 127.0.0.1:<随机端口> 起 NanoWSD：GET / 设备管理页、POST /_ctrl/connect 连接、其余路径反向代理；
 * - 中继证书 TOFU 固定（首连捕获 SPKI sha256 落 SharedPreferences，此后 OkHttp CertificatePinner 校验；防中间人）；
 * - 每个请求 = /connect 签一次性 grant → WSS 隧道入口（/_whalemaid/tunnel-ws）→ GRANT → 转发 → 解码 chunked 响应；
 * - /api/events.* 的 WS 升级桥到同一隧道（官方事件下联）。
 */
@CapacitorPlugin(name = "WhaleMaidTunnel")
class WhaleMaidTunnelPlugin : Plugin() {

    @PluginMethod
    fun start(call: PluginCall) {
        val proxy = TunnelProxy(context, activity)
        proxy.start { port ->
            val ret = JSObject()
            ret.put("port", port)
            call.resolve(ret)
        }
    }
}

class TunnelProxy(private val ctx: Context, private val activity: Activity?) {
    companion object {
        const val MAX_BODY = 64L * 1024 * 1024
    }

    private val prefs: SharedPreferences = ctx.getSharedPreferences("whalemaid-tunnel", Context.MODE_PRIVATE)
    private val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    })

    data class Session(var server: String = "", var deviceId: String = "", var password: String = "")
    val session = Session()

    private fun pinOf(host: String, port: Int): String {
        val ssl = SSLContext.getInstance("TLS")
        ssl.init(null, trustAll, SecureRandom())
        val socket = ssl.socketFactory.createSocket(host, port) as SSLSocket
        socket.use {
            it.startHandshake()
            val cert = it.session.peerCertificates.first() as X509Certificate
            val digest = MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded)
            return Base64.encodeToString(digest, Base64.NO_WRAP)
        }
    }

    fun clientFor(server: String, relayPort: Int = 9080): OkHttpClient {
        val host = server.substringBefore(":")
        var pin = prefs.getString("pin_$server", null)
        if (pin == null) {
            pin = pinOf(host, relayPort)
            prefs.edit().putString("pin_$server", pin).apply()
        }
        return OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .certificatePinner(CertificatePinner.Builder().add(server, "sha256/$pin").build())
            .build()
    }

    fun relayRequest(server: String, path: String, method: String = "GET", body: String? = null, headers: Map<String, String> = emptyMap()): Pair<Int, String> {
        val rb = Request.Builder().url("https://$server$path")
        if (body != null) rb.method(method, body.toRequestBody("application/json".toMediaType())) else rb.method(method, null)
        headers.forEach { (k, v) -> rb.addHeader(k, v) }
        clientFor(server).newCall(rb.build()).execute().use { resp ->
            return Pair(resp.code, resp.body?.string() ?: "")
        }
    }

    fun tunnelExchange(httpHead: String, bodyBytes: ByteArray?): ByteArray {
        val (code, body) = relayRequest(session.server, "/_whalemaid/connect", "POST",
            """{"deviceId":"${session.deviceId}","password":"${session.password}"}""")
        if (code != 200) throw IOException("connect $code: $body")
        val grant = JSONObject(body).getString("grant")

        val out = ByteArrayOutputStream()
        val latch = CountDownLatch(1)
        val err = arrayOf<String?>(null)
        val ws = clientFor(session.server).newWebSocket(
            Request.Builder().url("wss://${session.server}/_whalemaid/tunnel-ws").build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: OkWebSocket, response: OkResponse) {
                    webSocket.send("GRANT $grant ${session.deviceId}")
                    webSocket.send(httpHead)
                    if (bodyBytes != null && bodyBytes.isNotEmpty()) webSocket.send(okio.ByteString.of(*bodyBytes))
                }
                override fun onMessage(webSocket: OkWebSocket, bytes: okio.ByteString) { out.write(bytes.toByteArray()) }
                override fun onMessage(webSocket: OkWebSocket, text: String) { out.write(text.toByteArray()) }
                override fun onClosing(webSocket: OkWebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
                override fun onClosed(webSocket: OkWebSocket, code: Int, reason: String) { latch.countDown() }
                override fun onFailure(webSocket: OkWebSocket, t: Throwable, response: OkResponse?) { err[0] = t.message; latch.countDown() }
            })
        if (!latch.await(15, TimeUnit.SECONDS) || err[0] != null) {
            ws.cancel()
            throw IOException("隧道失败: ${err[0] ?: "timeout"}")
        }
        return out.toByteArray()
    }

    private fun decodeChunked(buf: ByteArray): ByteArray = TunnelHttp.decodeChunked(buf)

    private fun parseResponse(raw: ByteArray): Triple<Int, Map<String, String>, ByteArray> = TunnelHttp.parseResponse(raw)

    private fun toTunnelRequest(method: String, uri: String, headers: Map<String, String>, bodyBytes: ByteArray?): String =
        TunnelHttp.buildTunnelRequest(method, uri, headers, bodyBytes)

    fun start(onReady: (Int) -> Unit) {
        val server = object : NanoWSD(0) {
            override fun openWebSocket(handshake: IHTTPSession): NanoWSD.WebSocket? {
                return if (handshake.uri.startsWith("/api/events")) WebSocketBridge(this@TunnelProxy, handshake) else null
            }

            override fun serve(session: IHTTPSession): NanoHTTPD.Response {
                return try {
                    val uri = session.uri
                    val method = session.method?.name ?: "GET"
                    when (TunnelHttp.route(uri, method, this@TunnelProxy.session.server.isNotEmpty())) {
                        TunnelHttp.Route.MANAGEMENT -> {
                            val html = runCatching { activity?.assets?.open("public/index.html")?.use { String(it.readBytes()) } }.getOrNull()
                                ?: "<html><body>WhaleMaid</body></html>"
                            NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "text/html; charset=utf-8", html)
                        }
                        TunnelHttp.Route.CONNECT -> {
                            val bodyBytes = readBody(session) ?: ByteArray(0)
                            val json = JSONObject(String(bodyBytes, Charsets.UTF_8))
                            val serverAddr = json.optString("server").removePrefix("https://").removePrefix("http://").trimEnd('/')
                            val deviceId = json.optString("deviceId")
                            val password = json.optString("password")
                            if (serverAddr.isEmpty() || deviceId.isEmpty() || password.isEmpty()) return jsonResponse(400, """{"error":"server/deviceId/password 必填"}""")
                            this@TunnelProxy.session.server = serverAddr
                            this@TunnelProxy.session.deviceId = deviceId
                            this@TunnelProxy.session.password = password
                            val (code, respBody) = relayRequest(serverAddr, "/_whalemaid/devices/$deviceId/status")
                            if (code != 200) return jsonResponse(502, """{"error":"服务端不可达: $code"}""")
                            val st = JSONObject(respBody)
                            if (!st.optBoolean("registered")) return jsonResponse(404, """{"error":"设备编号不存在"}""")
                            if (!st.optBoolean("online")) return jsonResponse(503, """{"error":"设备不在线（受控端未开启或已离线）"}""")
                            val (authCode, _) = relayRequest(serverAddr, "/_whalemaid/connect", "POST",
                                """{"deviceId":"$deviceId","password":"$password"}""")
                            if (authCode != 200) return jsonResponse(401, """{"error":"密码错误"}""")
                            jsonResponse(200, """{"ok":true}""")
                        }
                        TunnelHttp.Route.TUNNEL -> {
                            val bodyBytes = readBody(session)
                            val head = toTunnelRequest(method, uri, session.headers, bodyBytes)
                            val raw = tunnelExchange(head, bodyBytes)
                            val (status, respHeaders, payload) = parseResponse(raw)
                            val resp = NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.lookup(status), "application/octet-stream", ByteArrayInputStream(payload), payload.size.toLong())
                            respHeaders.forEach { (k, v) -> if (k !in setOf("connection", "transfer-encoding", "content-length", "date")) resp.addHeader(k, v) }
                            resp
                        }
                    }
                } catch (e: Exception) {
                    jsonResponse(502, """{"error":"${(e.message ?: "internal").replace("\"", "'")}"}""")
                }
            }

            private fun readBody(session: IHTTPSession): ByteArray? {
                val cl = session.headers["content-length"]?.toLongOrNull() ?: return null
                if (cl <= 0 || cl > MAX_BODY) return null
                val out = ByteArrayOutputStream()
                val buf = ByteArray(8192)
                var remaining = cl
                val input = session.inputStream ?: return null
                while (remaining > 0) {
                    val n = input.read(buf, 0, minOf(remaining, buf.size.toLong()).toInt())
                    if (n < 0) break
                    out.write(buf, 0, n)
                    remaining -= n
                }
                return out.toByteArray()
            }

            private fun jsonResponse(status: Int, body: String): NanoHTTPD.Response =
                NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.lookup(status), "application/json; charset=utf-8", body)
        }
        server.start(0, false)
        val port = server.listeningPort
        activity?.runOnUiThread {
            (activity as? com.getcapacitor.BridgeActivity)?.bridge?.webView?.loadUrl("http://127.0.0.1:$port/")
        }
        onReady(port)
    }

    inner class WebSocketBridge(private val proxy: TunnelProxy, handshake: IHTTPSession) : NanoWSD.WebSocket(handshake) {
        private var up: OkWebSocket? = null
        private val pending = ConcurrentLinkedQueue<ByteArray>()

        override fun onOpen() {
            Thread {
                try {
                    val (code, body) = relayRequest(session.server, "/_whalemaid/connect", "POST",
                        """{"deviceId":"${session.deviceId}","password":"${session.password}"}""")
                    if (code != 200) { close(CloseCode.InternalServerError, "grant failed", false); return@Thread }
                    val grant = JSONObject(body).getString("grant")
                    up = clientFor(session.server).newWebSocket(
                        Request.Builder().url("wss://${session.server}/_whalemaid/tunnel-ws").build(),
                        object : WebSocketListener() {
                            override fun onOpen(webSocket: OkWebSocket, response: OkResponse) {
                                webSocket.send("GRANT $grant ${session.deviceId}")
                                val hs = getHandshakeRequest()
                                val key = hs.headers["sec-websocket-key"] ?: ""
                                // 用页面实际请求的事件通道（/api/events.mux 或 /api/events.host）而非硬编码
                                webSocket.send(TunnelHttp.buildEventsUpgradeRequest(hs.uri, key))
                                while (true) { val f = pending.poll() ?: break; webSocket.send(okio.ByteString.of(*f)) }
                            }
                            override fun onMessage(webSocket: OkWebSocket, bytes: okio.ByteString) { send(bytes.toByteArray()) }
                            override fun onMessage(webSocket: OkWebSocket, text: String) { send(text.toByteArray()) }
                            override fun onFailure(webSocket: OkWebSocket, t: Throwable, response: OkResponse?) {
                                close(CloseCode.InternalServerError, t.message ?: "bridge failed", false)
                            }
                            override fun onClosed(webSocket: OkWebSocket, code: Int, reason: String) {
                                close(CloseCode.NormalClosure, "upstream closed", false)
                            }
                        })
                } catch (e: Exception) { close(CloseCode.InternalServerError, e.message ?: "bridge failed", false) }
            }.start()
        }

        override fun onMessage(frame: NanoWSD.WebSocketFrame) {
            frame.binaryPayload?.let { pending.add(it) }
            frame.textPayload?.let { pending.add(it.toByteArray()) }
        }

        override fun onClose(code: CloseCode, reason: String, initiatedByRemote: Boolean) { up?.close(1000, null) }
        override fun onPong(pong: NanoWSD.WebSocketFrame) {}
        override fun onException(exception: IOException) { up?.close(1000, null) }
    }
}
