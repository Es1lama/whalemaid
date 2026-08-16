package com.whalemaid.controller

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ControllerCredentialSessionTest {
    @Test
    fun temporaryCredentialDropsPlaintextAndUsesOnlySessionToken() {
        val session = ControllerCredentialSession()
        session.commit("relay.test", "WHALE-A", "WMT-ABCD-EFGH", CredentialKind.TEMPORARY, "temp-token")

        assertEquals("", session.password)
        assertEquals("temp-token", session.authToken)
        assertEquals(
            JSONObject(mapOf("deviceId" to "WHALE-A", "sessionToken" to "temp-token")).toString(),
            session.payload(useToken = true).toString(),
        )
        assertFalse(session.canFallbackPassword(401))
    }

    @Test
    fun longTermCredentialMayFallbackOnlyAfterSessionRejection() {
        val session = ControllerCredentialSession()
        session.commit("relay.test", "WHALE-A", "LONG-PASSWORD", CredentialKind.LONG_TERM, "long-token")

        assertTrue(session.canFallbackPassword(401))
        assertFalse(session.canFallbackPassword(409))
        assertEquals("longTerm", session.payload(useToken = false).getString("credentialKind"))
        assertEquals("LONG-PASSWORD", session.payload(useToken = false).getString("password"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun unknownCredentialKindFailsClosed() {
        CredentialKind.fromWire("automatic")
    }
}
