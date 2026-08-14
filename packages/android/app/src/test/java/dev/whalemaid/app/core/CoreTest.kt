// SPEC: docs/requirements.md 纯逻辑单测（JVM，无 Android 依赖）
package dev.whalemaid.app.core

import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceIdsTest {
  @Test
  fun validAndInvalid() {
    assertTrue(DeviceIds.isValid("WHALE-TEST-DEVK"))
    assertFalse(DeviceIds.isValid("WHALE-TEST-DEV1")) // 排除 1
    assertFalse(DeviceIds.isValid("whale-test-devk"))
    assertFalse(DeviceIds.isValid("WHALE-ABCD-EFG"))
  }
}

class TocTest {
  @Test
  fun headings() {
    val toc = tocFromText("# 标题一\n正文\n## 子标题\n### 三级\n#### 四级\n##### 五级不收录")
    assertEquals(4, toc.size)
    assertEquals(1, toc[0].level)
    assertEquals("标题一", toc[0].title)
    assertEquals(4, toc[3].level)
  }
}

class EnvelopeTest {
  @Test
  fun requestRoundTrip() {
    val env = Envelope.request("device.handshake", mapOf("deviceId" to "WHALE-TEST-DEVK", "n" to 1, "ok" to true))
    assertEquals(1, env["v"].toString().toInt())
    assertEquals("device.handshake", env["method"].toString().trim('"'))
    assertTrue(env.toString().contains("WHALE-TEST-DEVK"))
  }

  @Test
  fun parseOkAndError() {
    val ok = Envelope.parseResponse("""{"v":1,"rpcId":"x","ok":true,"data":{"a":1}}""").getOrThrow()
    assertEquals("1", ok["a"].toString())
    val err = runCatching { Envelope.parseResponse("""{"v":1,"rpcId":"x","ok":false,"error":{"code":"auth-failed","message":"bad"}}""").getOrThrow() }.exceptionOrNull() as RpcError
    assertEquals("auth-failed", err.code)
  }
}

class ExtractTextTest {
  @Test
  fun pullsTextFields() {
    val obj = JsonObject(mapOf("content" to kotlinx.serialization.json.JsonPrimitive("hello")))
    assertEquals(listOf("hello"), extractText(obj))
  }
}
