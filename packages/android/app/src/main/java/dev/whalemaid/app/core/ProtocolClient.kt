// SPEC: docs/protocol.md#PROTO-001/003/004/005/006/007 协议客户端（OkHttp）
package dev.whalemaid.app.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.BufferedReader

class ProtocolClient(val base: String) {
  var token: String? = null
  private val client = OkHttpClient.Builder()
    .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
    .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
    .build()
  private val json = Json { ignoreUnknownKeys = true }

  private val jsonMedia = "application/json; charset=utf-8".toMediaType()

  fun call(method: String, payload: Map<String, Any?>): JsonObject {
    val body = Envelope.request(method, payload).toString()
    val req = Request.Builder()
      .url("$base/api/v1?method=$method")
      .post(body.toRequestBody(jsonMedia))
      .apply { token?.let { header("authorization", "Bearer $it") } }
      .build()
    client.newCall(req).execute().use { res ->
      val text = res.body?.string() ?: ""
      return Envelope.parseResponse(text).getOrThrow()
    }
  }

  // 认证（PROTO-003）
  fun handshake(deviceId: String, publicKeyJwk: JsonObject): Pair<String, List<String>> {
    val d = call("device.handshake", mapOf("deviceId" to deviceId, "publicKeyJwk" to publicKeyJwk))
    return d["nonce"]!!.jsonPrimitive.content to (d["caps"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList())
  }

  fun bind(deviceId: String, nonce: String, password: String, nonceSignature: String): String =
    call("device.bind", mapOf("deviceId" to deviceId, "nonce" to nonce, "password" to password, "nonceSignature" to nonceSignature))["deviceToken"]!!.jsonPrimitive.content

  fun bindTemporary(deviceId: String, password: String): String =
    call("device.bindTemporary", mapOf("deviceId" to deviceId, "password" to password))["deviceToken"]!!.jsonPrimitive.content

  // 会话（PROTO-004）
  fun sessionList(): JsonObject = call("session.list", emptyMap())
  fun sessionHistory(sessionId: String, maxMessages: Int = 50): JsonObject =
    call("session.history", mapOf("sessionId" to sessionId, "maxMessages" to maxMessages))
  fun sessionCreate(workspaceId: String? = null): JsonObject =
    call("session.create", workspaceId?.let { mapOf("workspaceId" to it) } ?: emptyMap())
  fun prompt(sessionId: String, text: String, visionNote: String? = null): JsonObject =
    call("session.prompt", mapOf("sessionId" to sessionId, "text" to text, "visionNote" to visionNote))
  fun stop(sessionId: String): JsonObject = call("session.stop", mapOf("sessionId" to sessionId))
  fun models(sessionId: String): JsonObject = call("session.models", mapOf("sessionId" to sessionId))
  fun selectModel(sessionId: String, provider: String, model: String, reasoningEffort: String? = null): JsonObject =
    call("session.selectModel", mapOf("sessionId" to sessionId, "provider" to provider, "model" to model, "reasoningEffort" to reasoningEffort))
  fun permissionGet(sessionId: String): JsonObject = call("permission.get", mapOf("sessionId" to sessionId))
  fun permissionSet(sessionId: String, value: String): JsonObject = call("permission.set", mapOf("sessionId" to sessionId, "value" to value))

  /** 审批应答（REQ-008）：回显宿主稳定 rpcId */
  fun approvalRespond(rpcId: String, sessionId: String, approvalId: String, outcome: String): JsonObject =
    call("approval.respond", mapOf("rpcId" to rpcId, "sessionId" to sessionId, "approvalId" to approvalId, "outcome" to outcome))

  // 工作区/目录（PROTO-007）
  fun workspaceList(): JsonObject = call("workspace.list", emptyMap())
  fun listDirectory(path: String? = null): JsonObject = call("host.listDirectory", path?.let { mapOf("path" to it) } ?: emptyMap())
  fun createDirectory(path: String, name: String): JsonObject = call("host.createDirectory", mapOf("path" to path, "name" to name))
  fun workspaceCreate(path: String): JsonObject = call("workspace.create", mapOf("path" to path))

  // 语音/视觉（PROTO-005/006）
  fun voiceTranscribe(audioBase64: String, format: String): String =
    call("voice.transcribe", mapOf("audioBase64" to audioBase64, "format" to format))["text"]?.jsonPrimitive?.contentOrNull ?: ""
  fun visionDescribe(imageBase64: String, mime: String): String =
    call("vision.describe", mapOf("imageBase64" to imageBase64, "mime" to mime))["text"]?.jsonPrimitive?.contentOrNull ?: ""

  /** SSE（PROTO-001）：手动读取 event stream，data 帧交给回调 */
  fun events(onEvent: (JsonObject) -> Unit, onDisconnect: (String?) -> Unit): Thread {
    val thread = Thread {
      try {
        val req = Request.Builder()
          .url("$base/api/v1/events")
          .apply { token?.let { header("authorization", "Bearer $it") } }
          .build()
        client.newCall(req).execute().use { res ->
          val reader = BufferedReader(res.body!!.charStream())
          var line: String?
          while (reader.readLine().also { line = it } != null) {
            if (line!!.startsWith("data: ")) {
              try {
                onEvent(json.parseToJsonElement(line!!.substring(6)).jsonObject)
              } catch (_: Exception) { /* 坏帧忽略 */ }
            }
          }
        }
        onDisconnect(null)
      } catch (e: Exception) {
        onDisconnect(e.message)
      }
    }
    thread.isDaemon = true
    thread.start()
    return thread
  }
}
