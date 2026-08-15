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

    private val pageHtml = "<html><body>WM-MGMT-PAGE</body></html>"

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
                fun get(path: String): Pair<Int, String> =
                    client.newCall(Request.Builder().url("http://127.0.0.1:$port$path").build())
                        .execute().use { it.code to (it.body?.string() ?: "") }
                fun post(path: String, body: String): Pair<Int, String> =
                    client.newCall(Request.Builder().url("http://127.0.0.1:$port$path")
                        .post(body.toRequestBody("application/json".toMediaType())).build())
                        .execute().use { it.code to (it.body?.string() ?: "") }

                // 1. 未连接 GET / → 管理页
                val (c1, b1) = get("/")
                results += if (c1 == 200 && b1.contains("WM-MGMT-PAGE")) "PASS 管理页" else "FAIL 管理页 $c1 ${b1.take(60)}"

                // 2. 连接
                val (c2, b2) = post("/_ctrl/connect", """{"server":"127.0.0.1:9180","deviceId":"WHALE-D68Z-7HBK","password":"W4saWTTZM4Mr"}""")
                results += if (c2 == 200 && b2.contains("ok")) "PASS connect $b2" else "FAIL connect $c2 $b2"

                // 3. 已连接 GET / → 隧道官方 UI
                val (c3, b3) = get("/")
                results += if (c3 == 200 && b3.contains("__DSH_BOOT__")) "PASS 官方UI(${b3.length}B)" else "FAIL 官方UI $c3 ${b3.take(80)}"

                // 4. 官方 /api 信封
                val payload = """{"type":"client-request","rpcId":"smoke1","method":"session.list","payload":{}}"""
                val (c4, b4) = post("/api/session.list", payload)
                results += if (c4 == 200 && b4.contains("server-response") && b4.contains("\"ok\":true")) "PASS 官方api" else "FAIL 官方api $c4 ${b4.take(80)}"

                // 5. 错误密码路径（同类全查：错误文案不崩）
                val (c5, b5) = post("/_ctrl/connect", """{"server":"127.0.0.1:9180","deviceId":"WHALE-D68Z-7HBK","password":"WRONG"}""")
                results += if (c5 == 401) "PASS 错密401" else "FAIL 错密 $c5 $b5"
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
