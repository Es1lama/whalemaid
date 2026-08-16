package com.whalemaid.controller

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ProxyCoreManagementHttpTest {
    @Test
    fun localManagementEndpointsNeverExposeAndDoDeleteTheSavedCredential() {
        val store = InMemoryControllerDeviceStore { 42L }
        store.rememberLongTerm("relay.example:9080", "WHALE-A", "DO-NOT-EXPOSE")
        val core = ProxyCore(
            pinStore = object : PinStore {
                override fun get(key: String): String? = null
                override fun put(key: String, value: String) = Unit
            },
            pageHtml = { "<html>TOKEN=__WHALEMAID_LOCAL_TOKEN__</html>" },
            deviceStore = store,
        )
        var port = 0
        core.start { port = it }
        val client = OkHttpClient()
        try {
            val forbidden = client.newCall(
                Request.Builder().url("http://127.0.0.1:$port/_ctrl/state").build(),
            ).execute().use { it.code }
            assertEquals(403, forbidden)
            val management = client.newCall(
                Request.Builder().url("http://127.0.0.1:$port/").build(),
            ).execute().use { it.body?.string() ?: "" }
            val token = Regex("TOKEN=([A-Za-z0-9_-]{40,})").find(management)?.groupValues?.get(1)
                ?: error("management token not injected")
            val stateResponse = client.newCall(
                Request.Builder().url("http://127.0.0.1:$port/_ctrl/state")
                    .header("x-whalemaid-controller", token)
                    .build(),
            ).execute().use { it.code to (it.body?.string() ?: "") }
            assertEquals(200, stateResponse.first)
            assertFalse(stateResponse.second.contains("DO-NOT-EXPOSE"))
            assertEquals("WHALE-A", JSONObject(stateResponse.second).getJSONArray("devices").getJSONObject(0).getString("deviceId"))

            val deleteResponse = client.newCall(
                Request.Builder().url("http://127.0.0.1:$port/_ctrl/device")
                    .header("x-whalemaid-controller", token)
                    .delete("""{"deviceId":"WHALE-A"}""".toRequestBody("application/json".toMediaType()))
                    .build(),
            ).execute().use { it.code to (it.body?.string() ?: "") }
            assertEquals(200, deleteResponse.first)
            assertEquals(true, JSONObject(deleteResponse.second).getBoolean("removed"))
            assertEquals(null, store.credential("WHALE-A"))
        } finally {
            core.stop()
        }
    }
}
