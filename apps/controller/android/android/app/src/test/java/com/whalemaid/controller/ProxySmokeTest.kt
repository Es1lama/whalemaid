package com.whalemaid.controller

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 本地全链冒烟（默认跳过；WHALEMAID_PROXY_SMOKE=1 时运行）：
 * 在 Mac 上启动 ProxyCore（纯 JVM），对真实中继(127.0.0.1:9180)+真实 DSH 测试宿主(3181) 跑
 * 管理页 → /_ctrl/connect → 隧道官方 UI → 官方 /api 的完整链路。
 * 设备端 e2e 只做一次：本冒烟全绿之后。
 */
class ProxySmokeTest {

    private val pageHtml = "<html><body>WM-MGMT-PAGE TOKEN=__WHALEMAID_LOCAL_TOKEN__</body></html>"

    @Test
    fun fullLoopLocally() {
        assumeTrue(System.getenv("WHALEMAID_PROXY_SMOKE") == "1")
        val pins = HashMap<String, String>()
        val core = ProxyCore(
            pinStore = object : PinStore {
                override fun get(key: String): String? = pins[key]
                override fun put(key: String, value: String) { pins[key] = value }
            },
            pageHtml = { pageHtml },
        )
        val latch = CountDownLatch(1)
        val results = mutableListOf<String>()
        core.start { port ->
            try {
                val client = OkHttpClient.Builder()
                    .connectTimeout(10, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
                var managementToken = ""
                fun get(path: String): Pair<Int, String> =
                    client.newCall(Request.Builder().url("http://127.0.0.1:$port$path").build())
                        .execute().use { it.code to (it.body?.string() ?: "") }
                fun post(path: String, body: String): Pair<Int, String> {
                    val request = Request.Builder().url("http://127.0.0.1:$port$path")
                    if (path.startsWith("/_ctrl/")) request.header("x-whalemaid-controller", managementToken)
                    return client.newCall(request.post(body.toRequestBody("application/json".toMediaType())).build())
                        .execute().use { it.code to (it.body?.string() ?: "") }
                }

                // 1. 未连接 GET / → 管理页
                val (c1, b1) = get("/")
                managementToken = Regex("TOKEN=([A-Za-z0-9_-]{40,})").find(b1)?.groupValues?.get(1) ?: ""
                results += if (c1 == 200 && b1.contains("WM-MGMT-PAGE") && managementToken.isNotEmpty()) "PASS 管理页" else "FAIL 管理页 $c1 ${b1.take(60)}"

                // 2. 连接
                val (c2, b2) = post("/_ctrl/connect", """{"server":"127.0.0.1:9180","deviceId":"WHALE-D68Z-7HBK","password":"W4saWTTZM4Mr","credentialKind":"longTerm"}""")
                results += if (c2 == 200 && b2.contains("ok") && core.session.authToken.isNotEmpty()) "PASS connect + sessionToken" else "FAIL connect $c2 token=${core.session.authToken.isNotEmpty()} $b2"

                // 3. 已连接 GET / → 隧道官方 UI（含 WebView 兼容 polyfill 注入）
                val (c3, b3) = get("/")
                results += if (c3 == 200 && b3.contains("__DSH_BOOT__") && b3.contains("whalemaid-polyfill")) "PASS 官方UI(${b3.length}B, polyfill已注入)" else "FAIL 官方UI $c3 polyfill=${b3.contains("whalemaid-polyfill")} ${b3.take(80)}"

                // 4. 官方 /api 信封
                val payload = """{"type":"client-request","rpcId":"smoke1","method":"session.list","payload":{}}"""
                val (c4, b4) = post("/api/session.list", payload)
                results += if (c4 == 200 && b4.contains("server-response") && b4.contains("\"ok\":true")) "PASS 官方api" else "FAIL 官方api $c4 ${b4.take(80)}"

                // 4b. 静态资源 Content-Type 透传（JS 模块严格 MIME 检查；硬编码 octet-stream 会白屏）
                // 分别用 普通头 与 Chrome 模块脚本头 复现设备端差异
                val assetSrc = Regex("src=\"(/assets/[^\"]+\\.js)\"").find(b3)?.groupValues?.get(1)
                if (assetSrc != null) {
                    val (ca, ba) = client.newCall(Request.Builder().url("http://127.0.0.1:$port$assetSrc").build())
                        .execute().use { it.code to (it.header("content-type") ?: "") }
                    results += if (ca == 200 && ba.contains("javascript")) "PASS 资源MIME(普通头) → $ba"
                    else "FAIL 资源MIME(普通头) $ca $ba"

                    val chromeLike = client.newCall(
                        Request.Builder().url("http://127.0.0.1:$port$assetSrc")
                            .header("Accept", "*/*")
                            .header("Sec-Fetch-Dest", "script")
                            .header("Sec-Fetch-Mode", "no-cors")
                            .header("Sec-Fetch-Site", "same-origin")
                            .header("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/101.0.4951.61 Mobile Safari/537.36")
                            .build()
                    ).execute().use { it.code to (it.header("content-type") ?: "") }
                    results += if (ca == 200 && ba.contains("javascript")) "PASS 资源MIME(Chrome头) → $ba"
                    else "FAIL 资源MIME(Chrome头) $ca $ba"
                } else {
                    results += "FAIL 官方HTML中未找到assets脚本"
                }

                // 4c. 高频签 grant 回归（SEC-002 修订）：官方 UI 加载 20+ 资源，每个资源一次 /connect；
                // 成功验证不得消耗窗口预算（曾因 5/min 窗口导致白屏）
                if (assetSrc != null) {
                    var burstOk = 0
                    var burstFail = ""
                    for (i in 1..10) {
                        val (cb, _) = client.newCall(Request.Builder().url("http://127.0.0.1:$port$assetSrc").build())
                            .execute().use { it.code to (it.body?.string()?.length ?: 0) }
                        if (cb == 200) burstOk++ else burstFail = "第$i 次 $cb"
                    }
                    results += if (burstOk == 10) "PASS 高频grant×10" else "FAIL 高频grant $burstOk/10 $burstFail"
                }

                // 5. 错误密码路径（同类全查：错误文案不崩）
                val (c5, b5) = post("/_ctrl/connect", """{"server":"127.0.0.1:9180","deviceId":"WHALE-D68Z-7HBK","password":"WRONG","credentialKind":"longTerm"}""")
                results += if (c5 == 401) "PASS 错密401" else "FAIL 错密 $c5 $b5"

                // 6. 事件 WS 桥：/api/events.mux upgrade → 隧道 → 宿主官方事件通道（官方前端靠它接收 turn/message 流）
                // 强断言：本地 101 后存活 6s；且首帧不得是上联 HTTP 101 头（曾把协议头当 WS 帧转发导致官方客户端断开重连）
                val wsLatch = CountDownLatch(1)
                var wsOpened = false
                var wsClosed = ""
                var firstFrameHead = "none"
                client.newWebSocket(
                    Request.Builder().url("ws://127.0.0.1:$port/api/events.mux").build(),
                    object : okhttp3.WebSocketListener() {
                        override fun onOpen(webSocket: okhttp3.WebSocket, response: okhttp3.Response) {
                            wsOpened = true
                            wsLatch.countDown()
                        }
                        override fun onMessage(webSocket: okhttp3.WebSocket, bytes: okio.ByteString) {
                            if (firstFrameHead == "none") firstFrameHead = bytes.toByteArray().copyOf(40).toString(Charsets.US_ASCII)
                        }
                        override fun onFailure(webSocket: okhttp3.WebSocket, t: Throwable, response: okhttp3.Response?) {
                            wsClosed = "fail:${t.message}"
                            wsLatch.countDown()
                        }
                        override fun onClosed(webSocket: okhttp3.WebSocket, code: Int, reason: String) {
                            wsClosed = "closed:$code:$reason"
                            wsLatch.countDown()
                        }
                    })
                wsLatch.await(10, TimeUnit.SECONDS)
                if (wsOpened) {
                    Thread.sleep(6000) // 观察窗：上联失败会在 ~1s 内关闭本地 WS
                    results += when {
                        wsClosed.isNotEmpty() -> "FAIL 事件WS桥 $wsClosed"
                        firstFrameHead.startsWith("HTTP/1.1") -> "FAIL 事件WS桥 首帧是HTTP头: ${firstFrameHead.take(30)}"
                        else -> "PASS 事件WS桥(存活6s, 首帧=${firstFrameHead.take(20)})"
                    }
                } else {
                    results += "FAIL 事件WS桥未打开 $wsClosed"
                }
            } catch (e: Exception) {
                results += "EXCEPTION ${e.message}"
            } finally {
                latch.countDown()
            }
        }
        assertTrue("smoke 未在 60s 内完成", latch.await(60, TimeUnit.SECONDS))
        results.forEach { println("SMOKE | $it") }
        assertEquals("存在失败步骤:\n" + results.joinToString("\n"), 0, results.count { it.startsWith("FAIL") || it.startsWith("EXCEPTION") })
    }
}
