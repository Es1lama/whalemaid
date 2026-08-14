// SPEC: docs/protocol.md#PROTO-001/003..007 协议客户端（URLSession + 手写 SSE）
import Foundation

public final class ProtocolClient {
  public let base: String
  public var token: String?

  public init(base: String) {
    self.base = base.hasSuffix("/") ? String(base.dropLast()) : base
  }

  public enum ClientError: Error {
    case rpc(code: String, message: String)
    case http(Int)
    case malformed
  }

  private func call(method: String, payload: [String: Any]) throws -> [String: Any] {
    let env = Envelope.request(method: method, payload: payload)
    var req = URLRequest(url: URL(string: "\(base)/api/v1?method=\(method)")!)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
    req.httpBody = try JSONSerialization.data(withJSONObject: env)
    let sem = DispatchSemaphore(value: 0)
    var result: Result<[String: Any], Error> = .failure(ClientError.malformed)
    URLSession.shared.dataTask(with: req) { data, resp, err in
      defer { sem.signal() }
      if let err { result = .failure(err); return }
      guard let data else { result = .failure(ClientError.malformed); return }
      do { result = .success(try Envelope.parseResponse(data)) } catch { result = .failure(error) }
    }.resume()
    sem.wait()
    return try result.get()
  }

  // 认证（PROTO-003）
  public func handshake(deviceId: String, jwk: [String: String]) throws -> (nonce: String, caps: [String]) {
    let d = try call(method: "device.handshake", payload: ["deviceId": deviceId, "publicKeyJwk": jwk])
    return (d["nonce"] as? String ?? "", d["caps"] as? [String] ?? [])
  }

  public func bind(deviceId: String, nonce: String, password: String, signature: String) throws -> String {
    let d = try call(method: "device.bind", payload: ["deviceId": deviceId, "nonce": nonce, "password": password, "nonceSignature": signature])
    guard let t = d["deviceToken"] as? String else { throw ClientError.malformed }
    return t
  }

  public func bindTemporary(deviceId: String, password: String) throws -> String {
    let d = try call(method: "device.bindTemporary", payload: ["deviceId": deviceId, "password": password])
    guard let t = d["deviceToken"] as? String else { throw ClientError.malformed }
    return t
  }

  // 会话（PROTO-004）
  public func sessionList() throws -> [String: Any] { try call(method: "session.list", payload: [:]) }
  public func sessionHistory(_ id: String, max: Int = 50) throws -> [String: Any] {
    try call(method: "session.history", payload: ["sessionId": id, "maxMessages": max])
  }
  public func sessionCreate(workspaceId: String?) throws -> [String: Any] {
    try call(method: "session.create", payload: workspaceId.map { ["workspaceId": $0] } ?? [:])
  }
  public func prompt(_ id: String, text: String, visionNote: String? = nil) throws -> [String: Any] {
    try call(method: "session.prompt", payload: ["sessionId": id, "text": text, "visionNote": visionNote ?? NSNull()])
  }
  public func stop(_ id: String) throws -> [String: Any] { try call(method: "session.stop", payload: ["sessionId": id]) }
  public func models(_ id: String) throws -> [String: Any] { try call(method: "session.models", payload: ["sessionId": id]) }
  public func selectModel(_ id: String, provider: String, model: String, effort: String? = nil) throws -> [String: Any] {
    try call(method: "session.selectModel", payload: ["sessionId": id, "provider": provider, "model": model, "reasoningEffort": effort ?? NSNull()])
  }
  public func permissionGet(_ id: String) throws -> [String: Any] { try call(method: "permission.get", payload: ["sessionId": id]) }
  public func permissionSet(_ id: String, value: String) throws -> [String: Any] {
    try call(method: "permission.set", payload: ["sessionId": id, "value": value])
  }

  // 工作区/目录（PROTO-007）
  public func workspaceList() throws -> [String: Any] { try call(method: "workspace.list", payload: [:]) }
  public func listDirectory(_ path: String?) throws -> [String: Any] {
    try call(method: "host.listDirectory", payload: path.map { ["path": $0] } ?? [:])
  }
  public func createDirectory(path: String, name: String) throws -> [String: Any] {
    try call(method: "host.createDirectory", payload: ["path": path, "name": name])
  }
  public func workspaceCreate(path: String) throws -> [String: Any] {
    try call(method: "workspace.create", payload: ["path": path])
  }

  // 语音/视觉（PROTO-005/006）
  public func voiceTranscribe(audioBase64: String, format: String) throws -> String {
    let d = try call(method: "voice.transcribe", payload: ["audioBase64": audioBase64, "format": format])
    return d["text"] as? String ?? ""
  }
  public func visionDescribe(imageBase64: String, mime: String) throws -> String {
    let d = try call(method: "vision.describe", payload: ["imageBase64": imageBase64, "mime": mime])
    return d["text"] as? String ?? ""
  }

  /// SSE（PROTO-001）：逐行读取，data 帧交给回调；返回可取消的 Task
  public func events(onEvent: @escaping ([String: Any]) -> Void, onDisconnect: @escaping (String?) -> Void) -> Task<Void, Never> {
    Task.detached {
      var req = URLRequest(url: URL(string: "\(self.base)/api/v1/events")!)
      if let token = self.token { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
      do {
        let (bytes, _) = try await URLSession.shared.bytes(for: req)
        var line = ""
        for try await byte in bytes {
          let c = Character(UnicodeScalar(byte))
          if c == "\n" {
            if line.hasPrefix("data: ") {
              if let data = String(line.dropFirst(6)).data(using: .utf8),
                 let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                onEvent(obj)
              }
            }
            line = ""
          } else { line.append(c) }
        }
        onDisconnect(nil)
      } catch {
        onDisconnect(error.localizedDescription)
      }
    }
  }
}
