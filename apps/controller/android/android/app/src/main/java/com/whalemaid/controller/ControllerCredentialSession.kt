package com.whalemaid.controller

import org.json.JSONObject

enum class CredentialKind(val wire: String) {
    LONG_TERM("longTerm"),
    TEMPORARY("temporary");

    companion object {
        fun fromWire(value: String): CredentialKind = entries.firstOrNull { it.wire == value }
            ?: throw IllegalArgumentException("credentialKind must be longTerm or temporary")
    }
}

class ControllerCredentialSession {
    @Volatile var server: String = ""
        private set
    @Volatile var deviceId: String = ""
        private set
    @Volatile var password: String = ""
        private set
    @Volatile var hostAuthority: String = ""
        private set
    @Volatile var authToken: String = ""
    @Volatile var credentialKind: CredentialKind = CredentialKind.LONG_TERM
        private set

    val connected: Boolean
        get() = server.isNotEmpty() && deviceId.isNotEmpty() && hostAuthority.isNotEmpty() && authToken.isNotEmpty()

    fun commit(
        server: String,
        deviceId: String,
        password: String,
        credentialKind: CredentialKind,
        authToken: String,
        hostAuthority: String,
    ) {
        require(authToken.isNotEmpty()) { "relay response missing sessionToken" }
        require(TunnelHttp.isValidHostAuthority(hostAuthority)) { "relay response missing valid hostAuthority" }
        this.server = server
        this.deviceId = deviceId
        this.password = if (credentialKind == CredentialKind.LONG_TERM) password else ""
        this.credentialKind = credentialKind
        this.authToken = authToken
        this.hostAuthority = hostAuthority
    }

    fun updateHostAuthority(value: String) {
        require(TunnelHttp.isValidHostAuthority(value)) { "relay response missing valid hostAuthority" }
        hostAuthority = value
    }

    fun clear() {
        server = ""
        deviceId = ""
        password = ""
        hostAuthority = ""
        authToken = ""
        credentialKind = CredentialKind.LONG_TERM
    }

    fun payload(useToken: Boolean): JSONObject {
        val value = JSONObject().put("deviceId", deviceId)
        if (useToken) return value.put("sessionToken", authToken)
        check(credentialKind == CredentialKind.LONG_TERM && password.isNotEmpty()) {
            "temporary credential cannot fall back to password"
        }
        return value
            .put("password", password)
            .put("credentialKind", CredentialKind.LONG_TERM.wire)
    }

    fun canFallbackPassword(status: Int): Boolean =
        status == 401 && credentialKind == CredentialKind.LONG_TERM && password.isNotEmpty()
}
