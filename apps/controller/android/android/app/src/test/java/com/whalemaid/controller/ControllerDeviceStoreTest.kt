package com.whalemaid.controller

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ControllerDeviceStoreTest {
    @Test
    fun longTermDevicesAreReturnedWithoutTheirPasswords() {
        var now = 10L
        val store = InMemoryControllerDeviceStore { now++ }
        store.rememberLongTerm("relay.example:9080", "whale-old", "OLD-SECRET")
        store.rememberLongTerm("relay.example:9080", "whale-new", "NEW-SECRET")

        assertEquals(listOf("WHALE-NEW", "WHALE-OLD"), store.devices().map { it.deviceId })
        assertEquals("relay.example:9080", store.configuredServer())
        assertFalse(store.devices().joinToString().contains("SECRET"))
        assertEquals("OLD-SECRET", store.credential("whale-old")?.password)
    }

    @Test
    fun removingADeviceAlsoRemovesItsCredential() {
        val store = InMemoryControllerDeviceStore()
        store.rememberLongTerm("relay.example:9080", "WHALE-A", "SECRET")

        assertTrue(store.remove("whale-a"))
        assertNull(store.credential("WHALE-A"))
        assertTrue(store.devices().isEmpty())
        assertFalse(store.remove("WHALE-A"))
    }

    @Test
    fun configuringServerDoesNotCreateAFakeDevice() {
        val store = InMemoryControllerDeviceStore()

        store.configureServer("relay.example:9080")

        assertEquals("relay.example:9080", store.configuredServer())
        assertTrue(store.devices().isEmpty())
    }
}
