// SPEC: docs/protocol.md 纯逻辑核心（JVM 可测，不含 Android 依赖）
package dev.whalemaid.app.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

const val PROTOCOL_VERSION = 1

/** SPEC: docs/protocol.md#PROTO-003 设备 ID 格式 */
object DeviceIds {
  private val PATTERN = Regex("^WHALE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$")
  fun isValid(id: String): Boolean = PATTERN.matches(id)
}

/** SPEC: docs/requirements.md#REQ-010 目录模式 */
data class TocItem(val level: Int, val title: String)

fun tocFromText(text: String): List<TocItem> = text.lineSequence()
  .mapNotNull { line -> Regex("^(#{1,4})\\s+(.+)$").find(line)?.let { TocItem(it.groupValues[1].length, it.groupValues[2].take(60)) } }
  .toList()

class RpcError(val code: String, message: String) : Exception("$code: $message")

private val json = Json { ignoreUnknownKeys = true }

/** SPEC: docs/protocol.md#PROTO-001 信封构造/解析 */
object Envelope {
  fun request(method: String, payload: Map<String, Any?>): JsonObject = buildJsonObject {
    put("v", JsonPrimitive(PROTOCOL_VERSION))
    put("rpcId", JsonPrimitive(java.util.UUID.randomUUID().toString()))
    put("method", JsonPrimitive(method))
    put("payload", payload.toJson())
  }

  fun parseResponse(body: String): Result<JsonObject> {
    val obj = json.parseToJsonElement(body).jsonObject
    val ok = obj["ok"]?.jsonPrimitive?.contentOrNull?.toBoolean() ?: return Result.failure(RpcError("bad-request", "invalid envelope"))
    if (ok) return Result.success(obj["data"]?.jsonObject ?: JsonObject(emptyMap()))
    val err = obj["error"]?.jsonObject ?: JsonObject(emptyMap())
    return Result.failure(RpcError(err["code"]?.jsonPrimitive?.contentOrNull ?: "server-error", err["message"]?.jsonPrimitive?.contentOrNull ?: "unknown"))
  }
}

private fun Map<String, Any?>.toJson(): JsonObject = buildJsonObject {
  for ((k, v) in this@toJson) put(k, when (v) {
    null -> JsonPrimitive(null as String?)
    is String -> JsonPrimitive(v)
    is Int -> JsonPrimitive(v)
    is Long -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is Double -> JsonPrimitive(v)
    is List<*> -> kotlinx.serialization.json.JsonArray(v.map { JsonPrimitive(it?.toString() ?: "") })
    is Map<*, *> -> (v as Map<String, Any?>).toJson()
    else -> JsonPrimitive(v.toString())
  })
}

/** 从 DSH HistoryEntry 尽力提取文本（与 Web 端同策略） */
fun extractText(value: JsonObject, depth: Int = 0): List<String> {
  if (depth > 3) return emptyList()
  val out = mutableListOf<String>()
  for ((k, v) in value) {
    if (k in setOf("content", "text", "delta", "title", "name", "prompt", "message")) {
      when (v) {
        is JsonPrimitive -> if (v.contentOrNull != null) out.add(v.content)
        is JsonObject -> out.addAll(extractText(v, depth + 1))
        is kotlinx.serialization.json.JsonArray -> for (e in v) if (e is JsonObject) out.addAll(extractText(e, depth + 1))
      }
    }
  }
  return out
}
