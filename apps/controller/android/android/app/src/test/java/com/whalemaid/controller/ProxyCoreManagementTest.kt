package com.whalemaid.controller

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ProxyCoreManagementTest {
    private fun core(store: ControllerDeviceStore = InMemoryControllerDeviceStore()): ProxyCore = ProxyCore(
        pinStore = object : PinStore {
            override fun get(key: String): String? = null
            override fun put(key: String, value: String) = Unit
        },
        pageHtml = { "<html></html>" },
        deviceStore = store,
    )

    @Test
    fun pageSnapshotContainsDeviceMetadataButNeverTheSavedPassword() {
        val store = InMemoryControllerDeviceStore { 42L }
        store.rememberLongTerm("relay.example:9080", "whale-a", "DO-NOT-EXPOSE")

        val raw = core(store).managementState()
        val snapshot = JSONObject(raw)
        val device = snapshot.getJSONArray("devices").getJSONObject(0)

        assertEquals("relay.example:9080", snapshot.getString("server"))
        assertEquals("WHALE-A", device.getString("deviceId"))
        assertEquals("relay.example:9080", device.getString("server"))
        assertEquals(42L, device.getLong("lastConnectedAt"))
        assertFalse(raw.contains("DO-NOT-EXPOSE"))
        assertFalse(raw.contains("password"))
        assertFalse(raw.contains("sessionToken"))
    }

    @Test
    fun serverNormalizationAcceptsDomainOrHttpsAndRejectsPaths() {
        val core = core()

        assertEquals("relay.example:9080", core.normalizeServer("relay.example:9080"))
        assertEquals("relay.example", core.normalizeServer("https://relay.example/"))
        assertTrue(runCatching { core.normalizeServer("relay.example/private") }.isFailure)
        assertTrue(runCatching { core.normalizeServer("user:pass@relay.example") }.isFailure)
    }

    @Test
    fun officialHtmlDeclaresNonWritableControllerRuntimeBeforeDshBoot() {
        val source = "<html><head><script>window.__DSH_BOOT__={}</script></head><body></body></html>".toByteArray()
        val first = core().injectPolyfill(source).toString(Charsets.UTF_8)
        val roleAt = first.indexOf("Object.defineProperty(globalThis, '__WHALEMAID_RUNTIME_ROLE__'")
        val bootAt = first.indexOf("window.__DSH_BOOT__")

        assertTrue(roleAt > first.indexOf("<head>"))
        assertTrue(roleAt < bootAt)
        assertTrue(first.contains("value: 'controller', writable: false, configurable: false"))
        assertEquals(first, core().injectPolyfill(first.toByteArray()).toString(Charsets.UTF_8))
    }

    @Test
    fun relayClientIsSharedPerNormalizedAuthorityAndReleasedOnStop() {
        val core = ProxyCore(
            pinStore = object : PinStore {
                override fun get(key: String): String = "test-pin"
                override fun put(key: String, value: String) = Unit
            },
            pageHtml = { "<html></html>" },
        )

        val first = core.clientFor("https://relay.example:9080/")
        assertSame(first, core.clientFor("relay.example:9080"))
        assertNotSame(first, core.clientFor("relay.example:9443"))

        core.stop()
        assertNotSame(first, core.clientFor("relay.example:9080"))
        core.stop()
    }
}
