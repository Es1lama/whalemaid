// SPEC: docs/requirements.md#REQ-001..011 Android 原生视图（Compose Material3）
package dev.whalemaid.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.whalemaid.app.core.DeviceIds
import dev.whalemaid.app.core.DeviceKey
import dev.whalemaid.app.core.ProtocolClient
import dev.whalemaid.app.core.TocItem
import dev.whalemaid.app.core.extractText
import dev.whalemaid.app.core.tocFromText
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlin.concurrent.thread

sealed class Screen {
  data object Login : Screen()
  data object Home : Screen()
  data class Chat(val sessionId: String) : Screen()
}

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    AppContextHolder.ctx = applicationContext
    setContent { MaterialTheme { WhaleApp() } }
  }
}

data class SessionRow(val id: String, val title: String)

@Composable
fun WhaleApp() {
  var screen by remember { mutableStateOf<Screen>(Screen.Login) }
  var client by remember { mutableStateOf<ProtocolClient?>(null) }

  val prefs = remember { Prefs() }
  val restore = remember {
    val base = prefs.get("base")
    val token = prefs.get("token")
    if (base != null && token != null) {
      ProtocolClient(base).also { it.token = token }
    } else null
  }
  if (client == null && restore != null) {
    client = restore
    screen = Screen.Home
  }

  Scaffold { pad ->
    Box(Modifier.fillMaxSize().padding(pad)) {
      when (val s = screen) {
        is Screen.Login -> LoginScreen { c ->
          client = c
          prefs.set("base", c.base)
          prefs.set("token", c.token ?: "")
          screen = Screen.Home
        }
        is Screen.Home -> client?.let {
          HomeScreen(it, onOpen = { id -> screen = Screen.Chat(id) }, onLogout = {
            prefs.clear()
            client = null
            screen = Screen.Login
          })
        }
        is Screen.Chat -> client?.let { ChatScreen(it, s.sessionId, onBack = { screen = Screen.Home }) }
      }
    }
  }
}

class Prefs {
  private val sp = AppContextHolder.ctx.getSharedPreferences("whalemaid", 0)
  fun get(k: String): String? = sp.getString(k, null)
  fun set(k: String, v: String) = sp.edit().putString(k, v).apply()
  fun clear() = sp.edit().clear().apply()
}

object AppContextHolder {
  lateinit var ctx: android.content.Context
}

@Composable
fun LoginScreen(onConnected: (ProtocolClient) -> Unit) {
  var base by remember { mutableStateOf("") }
  var deviceId by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var temporary by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }

  Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Text("🐳 WhaleMaid", style = MaterialTheme.typography.headlineMedium)
    Text("让手机完全接管电脑上的 DeepSeek Harness", color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedTextField(base, { base = it }, label = { Text("主机地址 http://IP:3180") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(deviceId, { deviceId = it }, label = { Text("设备 ID WHALE-XXXX-XXXX") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(password, { password = it }, label = { Text(if (temporary) "临时密码" else "长期密码") }, modifier = Modifier.fillMaxWidth())
    Row(verticalAlignment = Alignment.CenterVertically) {
      Checkbox(temporary, { temporary = it })
      Text("使用临时密码")
    }
    if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
    Button(
      { if (busy) return@Button
        busy = true
        thread {
          try {
            val c = ProtocolClient(base.trimEnd('/'))
            if (temporary) {
              c.token = c.bindTemporary(deviceId, password)
            } else {
              val pair = DeviceKey.getOrCreateKeyPair()
              val jwk = DeviceKey.publicJwk(pair)
              val (nonce, _) = c.handshake(deviceId, jwk)
              val sig = DeviceKey.signNonce(pair, nonce)
              c.token = c.bind(deviceId, nonce, password, sig)
            }
            onConnected(c)
          } catch (e: Exception) {
            error = e.message ?: "连接失败"
            busy = false
          }
        }
      },
      enabled = !busy && DeviceIds.isValid(deviceId) && password.isNotEmpty(),
      modifier = Modifier.fillMaxWidth(),
    ) { Text("连接") }
  }
}

@Composable
fun HomeScreen(client: ProtocolClient, onOpen: (String) -> Unit, onLogout: () -> Unit) {
  var workspaces by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
  var sessions by remember { mutableStateOf<List<SessionRow>>(emptyList()) }
  var browsing by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf("") }

  fun load() {
    thread {
      try {
        val w = client.workspaceList()["items"]?.jsonArray?.map {
          val o = it.jsonObject
          o["workspaceId"]!!.jsonPrimitive.content to (o["title"]?.jsonPrimitive?.contentOrNull ?: o["path"]?.jsonPrimitive?.contentOrNull ?: o["workspaceId"]!!.jsonPrimitive.content)
        } ?: emptyList()
        val s = client.sessionList()["items"]?.jsonArray?.mapNotNull {
          val o = it.jsonObject
          if (o["blank"]?.jsonPrimitive?.contentOrNull == "true") null
          else SessionRow(o["sessionId"]!!.jsonPrimitive.content, o["title"]?.jsonPrimitive?.contentOrNull ?: o["sessionId"]!!.jsonPrimitive.content)
        } ?: emptyList()
        workspaces = w
        sessions = s
      } catch (e: Exception) {
        error = e.message ?: "加载失败"
      }
    }
  }
  androidx.compose.runtime.LaunchedEffect(Unit) { load() }

  Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Button({
        thread {
          try {
            val sid = client.sessionCreate(null)["sessionId"]!!.jsonPrimitive.content
            onOpen(sid)
          } catch (e: Exception) { error = e.message ?: "创建失败" }
        }
      }, modifier = Modifier.weight(1f)) { Text("＋ 新建会话") }
      Button({ browsing = true }, modifier = Modifier.weight(1f)) { Text("＋ 新建工作区") }
      OutlinedButton(onLogout) { Text("退出") }
    }
    if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
    Text("工作区", style = MaterialTheme.typography.titleMedium)
    LazyColumn(Modifier.weight(1f)) {
      items(workspaces) { (id, label) -> Card(Modifier.fillMaxWidth().padding(4.dp)) { Text(label, Modifier.padding(12.dp)) } }
      item { Text("会话（原生会话，REQ-005）", style = MaterialTheme.typography.titleMedium) }
      items(sessions) { s -> Card(Modifier.fillMaxWidth().padding(4.dp).clickable { onOpen(s.id) }) { Text(s.title, Modifier.padding(12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis) } }
    }
  }
  if (browsing) DirectoryDialog(client, onClose = { browsing = false }, onOpened = onOpen)
}

@Composable
fun DirectoryDialog(client: ProtocolClient, onClose: () -> Unit, onOpened: (String) -> Unit) {
  var path by remember { mutableStateOf("") }
  var entries by remember { mutableStateOf<List<String>>(emptyList()) }
  var crumbs by remember { mutableStateOf<List<String>>(emptyList()) }
  var newName by remember { mutableStateOf("") }
  var error by remember { mutableStateOf("") }

  fun nav(p: String? = null) {
    thread {
      try {
        val d = client.listDirectory(p)
        path = d["path"]?.jsonPrimitive?.contentOrNull ?: ""
        entries = d["entries"]?.jsonArray?.mapNotNull { it.jsonObject["name"]?.jsonPrimitive?.contentOrNull } ?: emptyList()
        crumbs = d["crumbs"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
      } catch (e: Exception) { error = e.message ?: "目录读取失败" }
    }
  }
  androidx.compose.runtime.LaunchedEffect(Unit) { nav() }

  Card(Modifier.fillMaxWidth().padding(16.dp)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text("选择工作区目录（REQ-009）", style = MaterialTheme.typography.titleMedium)
      Text(path, maxLines = 2, overflow = TextOverflow.Ellipsis)
      if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
      LazyColumn(Modifier.heightIn(max = 260.dp)) {
        items(entries) { name ->
          Text("📁 $name", Modifier.fillMaxWidth().clickable { nav(if (path == "/") "/$name" else "$path/$name") }.padding(8.dp))
        }
      }
      OutlinedTextField(newName, { newName = it }, label = { Text("新文件夹名") }, modifier = Modifier.fillMaxWidth())
      Button({
        thread {
          client.createDirectory(path, newName)
          newName = ""
          nav(path)
        }
      }, enabled = newName.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Text("新建文件夹") }
      Button({
        thread {
          try {
            val wid = client.workspaceCreate(path)["workspaceId"]!!.jsonPrimitive.content
            val sid = client.sessionCreate(wid)["sessionId"]!!.jsonPrimitive.content
            onOpened(sid)
          } catch (e: Exception) { error = e.message ?: "创建工作区失败" }
        }
      }, enabled = path.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Text("选择此目录并创建工作区") }
      OutlinedButton(onClose, Modifier.fillMaxWidth()) { Text("取消") }
    }
  }
}

@Composable
fun ChatScreen(client: ProtocolClient, sessionId: String, onBack: () -> Unit) {
  val messages = remember { mutableStateListOf<Pair<String, String>>() }
  var draft by remember { mutableStateOf("") }
  var running by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf("") }
  var showToc by remember { mutableStateOf(false) }
  var perm by remember { mutableStateOf<JsonObject?>(null) }

  fun load() {
    thread {
      try {
        val r = client.sessionHistory(sessionId, 50)
        messages.clear()
        for (ev in r["events"]?.jsonArray ?: emptyList()) {
          val chunks = extractText(ev.jsonObject)
          if (chunks.isNotEmpty()) messages.add("assistant" to chunks.joinToString("\n"))
        }
      } catch (e: Exception) { error = e.message ?: "历史加载失败" }
    }
  }
  // 审批卡片（REQ-008：原生审批流）
  var pendingApproval by remember { mutableStateOf<JsonObject?>(null) }

  androidx.compose.runtime.LaunchedEffect(sessionId) {
    load()
    client.events({ frame ->
      val type = frame["type"]?.jsonPrimitive?.contentOrNull
      val payload = frame["payload"]?.jsonObject
      when (type) {
        "turn-status" -> {
          val status = payload?.get("status")?.jsonPrimitive?.contentOrNull
          if (status == "running") running = true
          if (status == "done") { running = false; load() }
        }
        "permission-request" -> pendingApproval = payload
        "permission-resolved" -> pendingApproval = null
      }
    }, { })
    thread { runCatching { perm = client.permissionGet(sessionId)["permissions"]?.jsonObject } }
  }

  val fullText = messages.joinToString("\n\n") { it.second }
  val toc = remember(fullText) { tocFromText(fullText) }

  fun answerApproval(outcome: String) {
    val p = pendingApproval ?: return
    thread {
      runCatching {
        client.approvalRespond(
          p["rpcId"]?.jsonPrimitive?.contentOrNull.orEmpty(),
          p["sessionId"]?.jsonPrimitive?.contentOrNull.orEmpty(),
          p["approvalId"]?.jsonPrimitive?.contentOrNull.orEmpty(),
          outcome,
        )
      }
      pendingApproval = null
    }
  }

  // 模型/思考强度与权限预设（REQ-007/008：绝对原生的 dsh 体验）
  var sheet by remember { mutableStateOf<String?>(null) }
  var modelOptions by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
  var permOptions by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
  var permCurrent by remember { mutableStateOf("") }

  fun openModels() {
    thread {
      try {
        val d = client.models(sessionId)
        // 尽力提取 provider/model 目录（精确目录结构对齐见 TODO：session.models 类型）
        val opts = mutableListOf<Pair<String, String>>()
        val groups = d["providers"]?.jsonArray ?: d["groups"]?.jsonArray ?: emptyList()
        for (g in groups) {
          val go = g.jsonObject
          val pname = go["provider"]?.jsonPrimitive?.contentOrNull ?: go["name"]?.jsonPrimitive?.contentOrNull ?: continue
          val models = go["models"]?.jsonArray ?: emptyList()
          for (m in models) opts.add(pname to m.jsonObject["name"]?.jsonPrimitive?.contentOrNull.orEmpty())
        }
        modelOptions = opts
        sheet = "model"
      } catch (e: Exception) { error = e.message ?: "模型目录加载失败" }
    }
  }

  fun openPerms() {
    thread {
      try {
        val p = client.permissionGet(sessionId)["permissions"]?.jsonObject
        val opts = p?.get("options")?.jsonArray?.map {
          val o = it.jsonObject
          (o["value"]?.jsonPrimitive?.contentOrNull ?: "") to (o["name"]?.jsonPrimitive?.contentOrNull ?: "")
        } ?: emptyList()
        permOptions = opts
        permCurrent = p?.get("currentValue")?.jsonPrimitive?.contentOrNull ?: ""
        sheet = "perm"
      } catch (e: Exception) { error = e.message ?: "权限加载失败" }
    }
  }

  Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedButton(onBack) { Text("←") }
      Text("会话", style = MaterialTheme.typography.titleMedium)
      OutlinedButton({ showToc = !showToc }, enabled = toc.isNotEmpty()) { Text("目录") }
    }
    pendingApproval?.let { p ->
      Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Text("⚠ 需要审批：${p["toolName"]?.jsonPrimitive?.contentOrNull ?: "tool"}", style = MaterialTheme.typography.titleSmall)
          p["reason"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button({ answerApproval("allowed-once") }, Modifier.weight(1f)) { Text("允许") }
            OutlinedButton({ answerApproval("rejected") }, Modifier.weight(1f)) { Text("拒绝") }
          }
        }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedButton(::openModels) { Text("模型/思考强度") }
      OutlinedButton(::openPerms) { Text(if (permCurrent.isEmpty()) "权限" else "权限: $permCurrent") }
    }
    sheet?.let { s ->
      Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          when (s) {
            "model" -> {
              Text("模型与思考强度", style = MaterialTheme.typography.titleSmall)
              modelOptions.forEach { (pname, mname) ->
                Text("$pname / $mname", Modifier.fillMaxWidth().clickable {
                  thread {
                    runCatching { client.selectModel(sessionId, pname, mname) }
                    sheet = null
                  }
                }.padding(6.dp))
              }
            }
            "perm" -> {
              Text("权限预设", style = MaterialTheme.typography.titleSmall)
              permOptions.forEach { (value, name) ->
                Text(if (value == permCurrent) "✓ ${name.ifEmpty { value }}" else name.ifEmpty { value },
                  Modifier.fillMaxWidth().clickable {
                    thread {
                      runCatching { client.permissionSet(sessionId, value) }
                      permCurrent = value
                      sheet = null
                    }
                  }.padding(6.dp))
              }
            }
          }
          OutlinedButton({ sheet = null }, Modifier.fillMaxWidth()) { Text("关闭") }
        }
      }
    }
    if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
    if (showToc) {
      Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(8.dp)) {
          toc.forEach { t -> Text("${"#".repeat(t.level)} ${t.title}", Modifier.padding(start = (t.level * 8).dp)) }
        }
      }
    }
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
      messages.forEach { (role, text) ->
        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
          Column(Modifier.padding(10.dp)) {
            Text(role, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(text)
          }
        }
      }
      if (running) Text("● 运行中…", color = MaterialTheme.colorScheme.primary)
    }
    OutlinedTextField(draft, { draft = it }, label = { Text("布置任务…") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Button({
        val text = draft
        draft = ""
        messages.add("user" to text)
        running = true
        thread {
          try { client.prompt(sessionId, text) } catch (e: Exception) { error = e.message ?: "发送失败" }
        }
      }, enabled = draft.isNotBlank() && !running, modifier = Modifier.weight(1f)) { Text("发送") }
      Button({ thread { runCatching { client.stop(sessionId) } } }, enabled = running, modifier = Modifier.weight(1f)) { Text("停止") }
    }
  }
}
