package com.whalemaid.controller

/** 页面可见的长期设备元数据。密码只可通过 credential() 在原生代理内取得。 */
data class SavedControllerDevice(
    val deviceId: String,
    val server: String,
    val lastConnectedAt: Long,
)

data class SavedLongTermCredential(
    val deviceId: String,
    val server: String,
    val password: String,
)

interface ControllerDeviceStore {
    fun configuredServer(): String?
    fun configureServer(server: String)
    fun migrateServer(from: String, to: String): Int
    fun devices(): List<SavedControllerDevice>
    fun rememberLongTerm(server: String, deviceId: String, password: String)
    fun credential(deviceId: String): SavedLongTermCredential?
    fun remove(deviceId: String): Boolean
}

/** JVM 冒烟用内存实现；生产 Android 必须使用 AndroidControllerDeviceStore。 */
class InMemoryControllerDeviceStore(
    private val now: () -> Long = System::currentTimeMillis,
) : ControllerDeviceStore {
    private var server: String? = null
    private val credentials = LinkedHashMap<String, SavedLongTermCredential>()
    private val lastConnected = LinkedHashMap<String, Long>()

    override fun configuredServer(): String? = server

    override fun configureServer(server: String) {
        this.server = server
    }

    override fun migrateServer(from: String, to: String): Int {
        if (from == to) return 0
        val matching = credentials.values.filter { it.server == from }
        matching.forEach { credential ->
            credentials[credential.deviceId] = credential.copy(server = to)
        }
        if (server == from) server = to
        return matching.size
    }

    override fun devices(): List<SavedControllerDevice> = credentials.values
        .map { SavedControllerDevice(it.deviceId, it.server, lastConnected[it.deviceId] ?: 0L) }
        .sortedByDescending { it.lastConnectedAt }

    override fun rememberLongTerm(server: String, deviceId: String, password: String) {
        require(server.isNotBlank() && deviceId.isNotBlank() && password.isNotEmpty())
        this.server = server
        val normalized = deviceId.uppercase()
        credentials[normalized] = SavedLongTermCredential(normalized, server, password)
        lastConnected[normalized] = now()
    }

    override fun credential(deviceId: String): SavedLongTermCredential? = credentials[deviceId.uppercase()]

    override fun remove(deviceId: String): Boolean {
        val normalized = deviceId.uppercase()
        lastConnected.remove(normalized)
        return credentials.remove(normalized) != null
    }
}
