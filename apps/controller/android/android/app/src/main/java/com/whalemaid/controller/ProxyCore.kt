package com.whalemaid.controller

import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoWSD
import fi.iki.elonen.NanoWSD.WebSocketFrame.CloseCode
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
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/** 指纹存取抽象：Android 用 SharedPreferences；本地冒烟用内存 Map。 */
interface PinStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
}

/**
 * WhaleMaid 主控端隧道代理核心（纯 JVM，无 Android 依赖；本地即可对真实中继/宿主全链冒烟）。
 * SPEC: docs/protocol.md#PROTO-001/003/008、docs/security-audit.md#SEC-001（TOFU 指纹固定）。
 * - 本地 NanoWSD：GET / 设备管理页（未连接）、POST /_ctrl/connect 连接、其余路径（含已连接 GET /）经隧道反代宿主官方 UI/API；
 * - 中继证书 TOFU：首次捕获 SPKI sha256 落 PinStore，此后 TrustManager.checkServerTrusted 强制比对（防中间人）；
 *   不用 OkHttp CertificatePinner——Android Conscrypt 栈下会话恢复会给出空对端链导致误杀；
 * - 每个隧道请求 = /connect 签一次性 grant → WSS /_whalemaid/tunnel-ws → GRANT → 转发 → 解码 chunked 响应；
 * - /api/events.* 的 WS 升级桥使用页面实际请求的 URI。
 */
class ProxyCore(
    private val pinStore: PinStore,
    private val pageHtml: () -> String,
    initialServer: String = "",
    initialDeviceId: String = "",
    initialPassword: String = "",
    private val onAuthenticated: (server: String, deviceId: String, password: String) -> Unit = { _, _, _ -> },
) {
    companion object {
        const val MAX_BODY = 64L * 1024 * 1024
        /** 固定本地代理端口：保证 WebView origin 稳定（localStorage/登录状态跨启动保留）；被占用时回退随机端口 */
        const val FIXED_PORT = 43969

        /**
         * 移动适配层 polyfill：官方前端用 AbortSignal.any/timeout（Chrome 116+），
         * 老 WebView（如 BlueStacks 内置 101）缺失时同步抛异常导致连接循环自杀。
         * 只在缺失时注入，不改变官方前端任何调用点（ADR-039 移动适配）。
         */
        val POLYFILL_SCRIPT = """
            <script id="whalemaid-polyfill">
            (function () {
              if (typeof AbortSignal === 'undefined') return;
              if (!AbortSignal.any) {
                AbortSignal.any = function (signals) {
                  var list = signals || [];
                  var c = new AbortController();
                  if (list.some(function (s) { return s && s.aborted; })) { c.abort(); return c.signal; }
                  list.forEach(function (s) {
                    if (!s) return;
                    s.addEventListener('abort', function () { c.abort(s.reason); }, { once: true });
                  });
                  return c.signal;
                };
              }
              if (!AbortSignal.timeout) {
                AbortSignal.timeout = function (ms) {
                  var c = new AbortController();
                  var t = setTimeout(function () { c.abort(new DOMException('TimeoutError', 'TimeoutError')); }, ms);
                  if (t && typeof t.unref === 'function') t.unref();
                  return c.signal;
                };
              }
            })();
            </script>
        """.trimIndent()
    }

    class Session(
        @Volatile var server: String = "",
        @Volatile var deviceId: String = "",
        @Volatile var password: String = "",
        @Volatile var authToken: String = "",
    )
    val session = Session(initialServer, initialDeviceId, initialPassword)

    private val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    })

    private fun spkiSha256(cert: X509Certificate): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded)
        return java.util.Base64.getEncoder().encodeToString(digest)
    }

    /** TOFU 捕获：信任一切握手，只取对端证书 SPKI 指纹（首次固定） */
    private fun capturePin(host: String, port: Int): String {
        val ssl = SSLContext.getInstance("TLS")
        ssl.init(null, trustAll, SecureRandom())
        val socket = ssl.socketFactory.createSocket(host, port) as SSLSocket
        socket.use {
            it.startHandshake()
            val cert = it.session.peerCertificates.first() as X509Certificate
            return spkiSha256(cert)
        }
    }

    /** SEC-001 指纹固定 TrustManager：每次握手在 checkServerTrusted 里比对整条链的 SPKI */
    private fun pinningTrustManager(host: String, port: Int): X509TrustManager {
        val key = "pin_$host:$port"
        var pin = pinStore.get(key)
        if (pin == null) {
            pin = capturePin(host, port)
            pinStore.put(key, pin)
        }
        val expected = pin
        return object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                if (chain.none { spkiSha256(it) == expected }) {
                    throw CertificateException("中继证书指纹不匹配（防中间人，SEC-001）")
                }
            }
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }
    }

    fun clientFor(server: String): OkHttpClient {
        val host = server.substringBefore(":")
        val port = TunnelHttp.controlPortOf(server)
        val manager = pinningTrustManager(host, port)
        val sslCtx = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(manager), SecureRandom()) }
        return OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .sslSocketFactory(sslCtx.socketFactory, manager)
            // 主机名校验冗余（中继自签证书 SAN 为 whalemaid-relay）；身份由指纹强制
            .hostnameVerifier { _, _ -> true }
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

    /** 官方 HTML 头部注入 WebView 兼容 polyfill（幂等） */
    private fun injectPolyfill(html: ByteArray): ByteArray {
        val text = html.toString(Charsets.UTF_8)
        if (text.contains("whalemaid-polyfill")) return html
        val idx = text.indexOf("<head")
        if (idx < 0) return html
        val insertAt = text.indexOf('>', idx) + 1
        return (text.substring(0, insertAt) + POLYFILL_SCRIPT + text.substring(insertAt)).toByteArray(Charsets.UTF_8)
    }

    /** 首次以密码认证，之后只在当前进程内复用短期 sessionToken；令牌过期时自动回退一次密码。 */
    fun requestGrant(): String {
        fun exchange(useToken: Boolean): Pair<Int, String> {
            val payload = JSONObject().put("deviceId", session.deviceId)
            if (useToken) payload.put("sessionToken", session.authToken) else payload.put("password", session.password)
            return relayRequest(session.server, "/_whalemaid/connect", "POST", payload.toString())
        }
        val usedToken = session.authToken.isNotEmpty()
        var response = exchange(usedToken)
        if (usedToken && response.first == 401) {
            session.authToken = ""
            response = exchange(false)
        }
        val (code, body) = response
        if (code != 200) throw IOException("connect $code: $body")
        val json = JSONObject(body)
        val issuedToken = json.optString("sessionToken")
        if (issuedToken.isNotEmpty()) session.authToken = issuedToken
        return json.getString("grant")
    }

    fun tunnelExchange(httpHead: String, bodyBytes: ByteArray?): ByteArray {
        val grant = requestGrant()

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

    /** 启动本地代理；onReady 回调端口（Android 侧负责把 WebView 指向 http://127.0.0.1:<port>/） */
    fun start(onReady: (Int) -> Unit) {
        fun newServer(port: Int): NanoWSD = object : NanoWSD(port) {
            override fun openWebSocket(handshake: IHTTPSession): NanoWSD.WebSocket? {
                if (handshake.uri.startsWith("/api/events")) {
                    println("[WhaleMaidTunnel] 事件WS握手 uri=${handshake.uri} hdrs=${handshake.headers.keys.joinToString(",")}")
                    return WebSocketBridge(this@ProxyCore, handshake)
                }
                return null
            }

            override fun serve(session: IHTTPSession): NanoHTTPD.Response {
                // WS 升级请求必须交还 NanoWSD 内置握手（否则被我们的路由当普通请求进隧道 → 502）
                if (session.uri.startsWith("/api/events")) {
                    println("[WhaleMaidTunnel] events请求 method=${session.method} uri=${session.uri} hdrs=${session.headers}")
                }
                if (isWebsocketRequested(session)) return super.serve(session)
                return try {
                    val uri = session.uri
                    val method = session.method?.name ?: "GET"
                    when (TunnelHttp.route(uri, method, this@ProxyCore.session.server.isNotEmpty())) {
                        TunnelHttp.Route.MANAGEMENT -> {
                            NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "text/html; charset=utf-8", pageHtml())
                        }
                        TunnelHttp.Route.CONNECT -> {
                            val bodyBytes = readBody(session) ?: ByteArray(0)
                            val json = JSONObject(String(bodyBytes, Charsets.UTF_8))
                            val serverAddr = json.optString("server").removePrefix("https://").removePrefix("http://").trimEnd('/')
                            val deviceId = json.optString("deviceId")
                            val password = json.optString("password")
                            if (serverAddr.isEmpty() || deviceId.isEmpty() || password.isEmpty()) return jsonResponse(400, """{"error":"server/deviceId/password 必填"}""")
                            this@ProxyCore.session.server = serverAddr
                            this@ProxyCore.session.deviceId = deviceId
                            this@ProxyCore.session.password = password
                            val (code, respBody) = relayRequest(serverAddr, "/_whalemaid/devices/$deviceId/status")
                            if (code != 200) return jsonResponse(502, """{"error":"服务端不可达: $code"}""")
                            val st = JSONObject(respBody)
                            if (!st.optBoolean("registered")) return jsonResponse(404, """{"error":"设备编号不存在"}""")
                            if (!st.optBoolean("online")) return jsonResponse(503, """{"error":"设备不在线（受控端未开启或已离线）"}""")
                            val authPayload = JSONObject().put("deviceId", deviceId).put("password", password)
                            val (authCode, authBody) = relayRequest(serverAddr, "/_whalemaid/connect", "POST", authPayload.toString())
                            if (authCode != 200) return jsonResponse(401, """{"error":"密码错误"}""")
                            this@ProxyCore.session.authToken = JSONObject(authBody).optString("sessionToken")
                            onAuthenticated(serverAddr, deviceId, password)
                            jsonResponse(200, """{"ok":true}""")
                        }
                        TunnelHttp.Route.TUNNEL -> {
                            val bodyBytes = readBody(session)
                            val head = TunnelHttp.buildTunnelRequest(method, uri, session.headers, bodyBytes)
                            val raw = tunnelExchange(head, bodyBytes)
                            val (status, respHeaders, payload0) = TunnelHttp.parseResponse(raw)
                            // 官方 HTML 注入 WebView 兼容 polyfill（老 WebView 缺 AbortSignal.any/timeout）
                            val payload = if (status == 200 && (respHeaders["content-type"] ?: "").contains("text/html")) {
                                injectPolyfill(payload0)
                            } else payload0
                            // 上游 Content-Type 原样透传（浏览器对 JS 模块执行严格 MIME 检查，硬编码 octet-stream 会白屏）
                            val resp = NanoHTTPD.newFixedLengthResponse(NanoStatus.of(status), respHeaders["content-type"] ?: "application/octet-stream", ByteArrayInputStream(payload), payload.size.toLong())
                            respHeaders.forEach { (k, v) -> if (k !in setOf("connection", "transfer-encoding", "content-length", "date", "content-type")) resp.addHeader(k, v) }
                            resp
                        }
                    }
                } catch (e: Exception) {
                    println("[WhaleMaidTunnel] 代理失败: ${e.message}")
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
                NanoHTTPD.newFixedLengthResponse(NanoStatus.of(status), "application/json; charset=utf-8", body)
        }
        var server: NanoWSD = newServer(FIXED_PORT)
        try {
            server.start(0, false)
        } catch (e: IOException) {
            println("[WhaleMaidTunnel] 固定端口 $FIXED_PORT 被占用，回退随机端口: ${e.message}")
            server = newServer(0)
            server.start(0, false)
        }
        onReady(server.listeningPort)
    }

    inner class WebSocketBridge(private val proxy: ProxyCore, handshake: IHTTPSession) : NanoWSD.WebSocket(handshake) {
        private var up: OkWebSocket? = null
        private val pending = ConcurrentLinkedQueue<ByteArray>()
        // 上联字节流：先吞掉宿主 WS 的 HTTP 101 响应头，随后按原 opcode/fin 逐帧重发（文本帧不可降级为二进制）
        private val upstreamBuf = ByteArrayOutputStream()
        private var upstreamHeadSkipped = false

        private fun opCodeFor(v: Int): NanoWSD.WebSocketFrame.OpCode? = when (v) {
            0 -> NanoWSD.WebSocketFrame.OpCode.Continuation
            1 -> NanoWSD.WebSocketFrame.OpCode.Text
            2 -> NanoWSD.WebSocketFrame.OpCode.Binary
            8 -> NanoWSD.WebSocketFrame.OpCode.Close
            9 -> NanoWSD.WebSocketFrame.OpCode.Ping
            10 -> NanoWSD.WebSocketFrame.OpCode.Pong
            else -> null
        }

        private fun feedUpstream(bytes: ByteArray) {
            upstreamBuf.write(bytes)
            if (!upstreamHeadSkipped) {
                val raw = upstreamBuf.toByteArray()
                val sep = TunnelHttp.indexOfCrlfCrlf(raw)
                if (sep < 0) return // 101 头未到齐，继续攒
                upstreamHeadSkipped = true
                upstreamBuf.reset()
                upstreamBuf.write(raw, sep + 4, raw.size - sep - 4)
            }
            val buf = upstreamBuf.toByteArray()
            var off = 0
            while (off < buf.size) {
                val frame = try {
                    TunnelHttp.WsFrames.tryParse(buf, off)
                } catch (e: IllegalArgumentException) {
                    println("[WhaleMaidTunnel] 上游帧协议违例: ${e.message}")
                    close(CloseCode.InternalServerError, e.message, false)
                    return
                } ?: break
                off += frame.consumed
                val op = opCodeFor(frame.opcode) ?: continue // 保留位/未知 opcode 丢弃该帧
                try {
                    sendFrame(NanoWSD.WebSocketFrame(op, frame.fin, frame.payload))
                } catch (e: IOException) {
                    println("[WhaleMaidTunnel] 帧转发失败: ${e.message}")
                    close(CloseCode.InternalServerError, e.message, false)
                    return
                }
            }
            upstreamBuf.reset()
            if (off < buf.size) upstreamBuf.write(buf, off, buf.size - off)
        }

        override fun onOpen() {
            val t0 = System.currentTimeMillis()
            Thread {
                try {
                    val grant = proxy.requestGrant()
                    up = clientFor(session.server).newWebSocket(
                        Request.Builder().url("wss://${session.server}/_whalemaid/tunnel-ws").build(),
                        object : WebSocketListener() {
                            override fun onOpen(webSocket: OkWebSocket, response: OkResponse) {
                                println("[WhaleMaidTunnel] 事件桥上联open +${System.currentTimeMillis() - t0}ms")
                                webSocket.send("GRANT $grant ${session.deviceId}")
                                val hs = getHandshakeRequest()
                                val key = hs.headers["sec-websocket-key"] ?: ""
                                val origin = hs.headers["origin"] ?: "http://${TunnelHttp.HOST_AUTHORITY}"
                                // 用页面实际请求的事件通道（/api/events.mux 或 /api/events.host）而非硬编码；Origin 透传（宿主 WS 信任栅栏校验）
                                webSocket.send(TunnelHttp.buildEventsUpgradeRequest(hs.uri, key, origin))
                                while (true) { val f = pending.poll() ?: break; webSocket.send(okio.ByteString.of(*f)) }
                            }
                            override fun onMessage(webSocket: OkWebSocket, bytes: okio.ByteString) { feedUpstream(bytes.toByteArray()) }
                            override fun onMessage(webSocket: OkWebSocket, text: String) { feedUpstream(text.toByteArray()) }
                            override fun onFailure(webSocket: OkWebSocket, t: Throwable, response: OkResponse?) {
                                println("[WhaleMaidTunnel] 事件桥上联失败 +${System.currentTimeMillis() - t0}ms: ${t.message} resp=${response?.code}")
                                close(CloseCode.InternalServerError, t.message ?: "bridge failed", false)
                            }
                            override fun onClosed(webSocket: OkWebSocket, code: Int, reason: String) {
                                println("[WhaleMaidTunnel] 事件桥上联关闭: $code $reason")
                                close(CloseCode.NormalClosure, "upstream closed", false)
                            }
                        })
                } catch (e: Exception) { println("[WhaleMaidTunnel] 事件桥异常: ${e.message}"); close(CloseCode.InternalServerError, e.message ?: "bridge failed", false) }
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
