package com.whalemaid.controller

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val STORE_NAME = "whalemaid-controller-devices"
private const val SERVER_KEY = "configured-server"
private const val DEVICES_KEY = "devices"
private const val KEY_ALIAS = "whalemaid-controller-long-term-v1"

/** ADR-043：长期密码只以 Android Keystore AES-GCM 密文保存，WebView 永远拿不到明文。 */
class AndroidControllerDeviceStore(context: Context) : ControllerDeviceStore {
    private val preferences = context.getSharedPreferences(STORE_NAME, Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    @Synchronized
    override fun configuredServer(): String? = preferences.getString(SERVER_KEY, null)?.takeIf { it.isNotBlank() }

    @Synchronized
    override fun configureServer(server: String) {
        require(server.isNotBlank())
        preferences.edit().putString(SERVER_KEY, server).apply()
    }

    @Synchronized
    override fun devices(): List<SavedControllerDevice> = readDevices().sortedByDescending { it.lastConnectedAt }

    @Synchronized
    override fun rememberLongTerm(server: String, deviceId: String, password: String) {
        require(server.isNotBlank() && deviceId.isNotBlank() && password.isNotEmpty())
        val normalized = deviceId.uppercase()
        val encrypted = encrypt(password)
        val next = readDevices().filterNot { it.deviceId == normalized }.toMutableList()
        next += SavedControllerDevice(normalized, server, System.currentTimeMillis())
        preferences.edit()
            .putString(SERVER_KEY, server)
            .putString(secretPreferenceKey(server, normalized), encrypted)
            .putString(DEVICES_KEY, encodeDevices(next))
            .apply()
    }

    @Synchronized
    override fun credential(deviceId: String): SavedLongTermCredential? {
        val normalized = deviceId.uppercase()
        val device = readDevices().firstOrNull { it.deviceId == normalized } ?: return null
        val key = secretPreferenceKey(device.server, normalized)
        val encrypted = preferences.getString(key, null) ?: return null
        val password = runCatching { decrypt(encrypted) }.getOrElse {
            remove(normalized)
            return null
        }
        return SavedLongTermCredential(normalized, device.server, password)
    }

    @Synchronized
    override fun migrateServer(from: String, to: String): Int {
        if (from == to) return 0
        val current = readDevices()
        val migrating = current.filter { it.server == from }
        if (migrating.isEmpty() && configuredServer() != from) return 0
        val editor = preferences.edit()
        migrating.forEach { device ->
            val oldKey = secretPreferenceKey(from, device.deviceId)
            val encrypted = preferences.getString(oldKey, null)
            if (encrypted != null) {
                editor.putString(secretPreferenceKey(to, device.deviceId), encrypted)
                editor.remove(oldKey)
            }
        }
        val next = current.map { if (it.server == from) it.copy(server = to) else it }
        editor.putString(DEVICES_KEY, encodeDevices(next))
        if (preferences.getString(SERVER_KEY, null) == from) editor.putString(SERVER_KEY, to)
        editor.apply()
        return migrating.size
    }

    @Synchronized
    override fun remove(deviceId: String): Boolean {
        val normalized = deviceId.uppercase()
        val current = readDevices()
        val removed = current.filter { it.deviceId == normalized }
        if (removed.isEmpty()) return false
        val editor = preferences.edit().putString(DEVICES_KEY, encodeDevices(current - removed.toSet()))
        removed.forEach { editor.remove(secretPreferenceKey(it.server, it.deviceId)) }
        editor.apply()
        return true
    }

    private fun readDevices(): List<SavedControllerDevice> {
        val raw = preferences.getString(DEVICES_KEY, "[]") ?: "[]"
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    val value = array.optJSONObject(index) ?: continue
                    val deviceId = value.optString("deviceId").uppercase()
                    val server = value.optString("server")
                    if (deviceId.isNotBlank() && server.isNotBlank()) {
                        add(SavedControllerDevice(deviceId, server, value.optLong("lastConnectedAt")))
                    }
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun encodeDevices(devices: List<SavedControllerDevice>): String = JSONArray().apply {
        devices.forEach { device ->
            put(JSONObject().apply {
                put("deviceId", device.deviceId)
                put("server", device.server)
                put("lastConnectedAt", device.lastConnectedAt)
            })
        }
    }.toString()

    private fun secretKey(): SecretKey {
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val encrypted = Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        return "$iv.$encrypted"
    }

    private fun decrypt(value: String): String {
        val parts = value.split('.', limit = 2)
        require(parts.size == 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        return cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)).toString(Charsets.UTF_8)
    }

    private fun secretPreferenceKey(server: String, deviceId: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest("$server\u0000$deviceId".toByteArray())
        return "credential-" + Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }
}
