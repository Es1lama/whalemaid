// SPEC: docs/requirements.md#REQ-001..011 iOS 原生视图（SwiftUI）
import SwiftUI

@main
struct WhalemaidApp: App {
  var body: some Scene {
    WindowGroup { RootView() }
  }
}

enum Route: Hashable {
  case login
  case home
  case chat(String)
}

final class AppModel: ObservableObject {
  @Published var route: Route = .login
  @Published var client: ProtocolClient?

  private let defaults = UserDefaults.standard

  init() {
    if let base = defaults.string(forKey: "base"), let token = defaults.string(forKey: "token") {
      let c = ProtocolClient(base: base)
      c.token = token
      client = c
      route = .home
    }
  }

  func save(base: String, token: String) {
    defaults.set(base, forKey: "base")
    defaults.set(token, forKey: "token")
  }

  func logout() {
    defaults.removeObject(forKey: "base")
    defaults.removeObject(forKey: "token")
    client = nil
    route = .login
  }
}

struct RootView: View {
  @StateObject private var model = AppModel()

  var body: some View {
    NavigationStack(path: Binding(
      get: { [model.route] },
      set: { model.route = $0.first ?? .home }
    )) {
      Group {
        switch model.route {
        case .login: LoginView(model: model)
        case .home: if let c = model.client { HomeView(client: c, model: model) }
        case .chat(let id): if let c = model.client { ChatView(client: c, sessionId: id, model: model) }
        }
      }
    }
  }
}

struct LoginView: View {
  @ObservedObject var model: AppModel
  @State private var base = ""
  @State private var deviceId = ""
  @State private var password = ""
  @State private var temporary = false
  @State private var error = ""
  @State private var busy = false

  var body: some View {
    Form {
      Section("WhaleMaid 🐳") {
        TextField("主机地址 http://192.168.x.x:3180", text: $base).keyboardType(.URL).textInputAutocapitalization(.never)
        TextField("设备 ID WHALE-XXXX-XXXX", text: $deviceId).textInputAutocapitalization(.characters)
        SecureField(temporary ? "临时密码" : "长期密码", text: $password)
        Toggle("使用临时密码", isOn: $temporary)
      }
      if !error.isEmpty { Text(error).foregroundStyle(.red) }
      Button {
        busy = true
        Task {
          do {
            let c = ProtocolClient(base: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
            if temporary {
              c.token = try c.bindTemporary(deviceId: deviceId, password: password)
            } else {
              let key = try DeviceKey.getOrCreateKeyPair()
              let jwk = try DeviceKey.publicJwk(key)
              let handshake = try c.handshake(deviceId: deviceId, jwk: jwk)
              let sig = try DeviceKey.signNonce(key, nonce: handshake.nonce)
              c.token = try c.bind(deviceId: deviceId, nonce: handshake.nonce, password: password, signature: sig)
            }
            model.save(base: c.base, token: c.token ?? "")
            model.client = c
            model.route = .home
          } catch {
            error = error.localizedDescription
            busy = false
          }
        }
      } label: { Text("连接") }
        .disabled(busy || !DeviceIds.isValid(deviceId) || password.isEmpty)
    }
  }
}

struct SessionRow: Identifiable, Hashable {
  let id: String
  let title: String
}

struct HomeView: View {
  let client: ProtocolClient
  @ObservedObject var model: AppModel
  @State private var workspaces: [String] = []
  @State private var sessions: [SessionRow] = []
  @State private var error = ""
  @State private var browsing = false

  private func load() {
    Task {
      do {
        let w = try client.workspaceList()
        workspaces = ((w["items"] as? [[String: Any]]) ?? []).compactMap { $0["title"] as? String ?? $0["path"] as? String }
        let s = try client.sessionList()
        sessions = ((s["items"] as? [[String: Any]]) ?? []).filter { $0["blank"] as? Bool != true }.map {
          SessionRow(id: $0["sessionId"] as? String ?? "", title: $0["title"] as? String ?? ($0["sessionId"] as? String ?? ""))
        }
      } catch { error = error.localizedDescription }
    }
  }

  var body: some View {
    List {
      Section {
        Button("＋ 新建会话") {
          Task {
            do {
              let r = try client.sessionCreate(workspaceId: nil)
              if let id = r["sessionId"] as? String { model.route = .chat(id) }
            } catch { error = error.localizedDescription }
          }
        }
        Button("＋ 新建工作区") { browsing = true }
        Button("退出登录", role: .destructive) { model.logout() }
      }
      if !error.isEmpty { Text(error).foregroundStyle(.red) }
      Section("工作区") {
        ForEach(workspaces, id: \.self) { Text($0) }
      }
      Section("会话（原生会话，REQ-005）") {
        ForEach(sessions) { s in
          Button(s.title) { model.route = .chat(s.id) }.foregroundStyle(.primary)
        }
      }
    }
    .navigationTitle("WhaleMaid")
    .onAppear(perform: load)
    .sheet(isPresented: $browsing) {
      DirectorySheet(client: client) { sessionId in
        browsing = false
        model.route = .chat(sessionId)
      }
    }
  }
}

struct DirectorySheet: View {
  let client: ProtocolClient
  let onOpened: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var path = ""
  @State private var entries: [String] = []
  @State private var newName = ""
  @State private var error = ""

  private func nav(_ p: String? = nil) {
    Task {
      do {
        let d = try client.listDirectory(p)
        path = d["path"] as? String ?? ""
        entries = ((d["entries"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
      } catch { error = error.localizedDescription }
    }
  }

  var body: some View {
    NavigationStack {
      List {
        Text(path).font(.caption).foregroundStyle(.secondary)
        if !error.isEmpty { Text(error).foregroundStyle(.red) }
        ForEach(entries, id: \.self) { name in
          Button("📁 \(name)") { nav(path == "/" ? "/\(name)" : "\(path)/\(name)") }
        }
        Section {
          TextField("新文件夹名", text: $newName)
          Button("新建文件夹") {
            Task {
              try? await Task.sleep(nanoseconds: 0)
              _ = try? client.createDirectory(path: path, name: newName)
              newName = ""
              nav(path)
            }
          }.disabled(newName.isEmpty)
          Button("选择此目录并创建工作区") {
            Task {
              do {
                let w = try client.workspaceCreate(path: path)
                guard let wid = w["workspaceId"] as? String else { return }
                let s = try client.sessionCreate(workspaceId: wid)
                if let sid = s["sessionId"] as? String { onOpened(sid) }
              } catch { error = error.localizedDescription }
            }
          }.disabled(path.isEmpty)
        }
      }
      .navigationTitle("选择工作区目录（REQ-009）")
      .onAppear { nav() }
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
    }
  }
}

struct ChatView: View {
  let client: ProtocolClient
  let sessionId: String
  @ObservedObject var model: AppModel
  @State private var messages: [(String, String)] = []
  @State private var draft = ""
  @State private var running = false
  @State private var error = ""
  @State private var showToc = false

  private func load() {
    Task {
      do {
        let r = try client.sessionHistory(sessionId, max: 50)
        var msgs: [(String, String)] = []
        for ev in (r["events"] as? [Any]) ?? [] {
          let chunks = extractText(ev)
          if !chunks.isEmpty { msgs.append(("assistant", chunks.joined(separator: "\n"))) }
        }
        messages = msgs
      } catch { error = error.localizedDescription }
    }
  }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading) {
          if showToc {
            ForEach(tocFromText(messages.map(\.1).joined(separator: "\n\n"))) { t in
              Text("\(String(repeating: "#", count: t.level)) \(t.title)").font(.caption).foregroundStyle(.blue)
            }
            Divider()
          }
          ForEach(Array(messages.enumerated()), id: \.offset) { i, m in
            VStack(alignment: .leading, spacing: 4) {
              Text(m.0).font(.caption2).foregroundStyle(.secondary)
              Text(m.1).textSelection(.enabled)
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .id(i)
          }
          if running { Text("● 运行中…").foregroundStyle(.blue) }
        }
        .padding()
      }
      .safeAreaInset(edge: .bottom) {
        VStack(spacing: 8) {
          if !error.isEmpty { Text(error).foregroundStyle(.red).font(.caption) }
          HStack {
            TextField("布置任务…", text: $draft, axis: .vertical).lineLimit(1...4).textFieldStyle(.roundedBorder)
            Button("发送") {
              let text = draft
              draft = ""
              messages.append(("user", text))
              running = true
              Task {
                do { _ = try client.prompt(sessionId, text: text) } catch { error = error.localizedDescription }
              }
            }.disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || running)
            Button("停止") { Task { _ = try? client.stop(sessionId) } }.disabled(!running)
          }
        }
        .padding()
        .background(.bar)
      }
    }
    .navigationTitle("会话")
    .toolbar {
      ToolbarItem(placement: .navigationBarLeading) { Button("←") { model.route = .home } }
      ToolbarItem(placement: .navigationBarTrailing) { Button("目录") { showToc.toggle() } }
    }
    .onAppear {
      load()
      Task {
        await client.events(onEvent: { frame in
          let status = (frame["payload"] as? [String: Any])?["status"] as? String
          if status == "running" { running = true }
          if status == "done" { running = false; load() }
        }, onDisconnect: { _ in })
      }
    }
  }
}
