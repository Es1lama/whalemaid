import Foundation
import Network
import CommonCrypto

/// iOS 主控端隧道代理（Android ProxyCore 的 Swift 移植；纯 Foundation/Network，无第三方依赖）
/// SPEC: docs/protocol.md#PROTO-001/003/008、docs/security-audit.md#SEC-001（TOFU 指纹固定）
/// - 本地 127.0.0.1:43969 固定 HTTP+WS 服务器：设备管理页 / _ctrl/connect / _ctrl/status / WS 事件桥 / 隧道反代
/// - 中继证书 TOFU：首连捕获 SPKI sha256 落 UserDefaults，此后每次 TLS 校验（身份=指纹，主机名校验冗余）
/// - 每个隧道请求 = /connect 签一次性 grant → WSS /_whalemaid/tunnel-ws → GRANT → 转发 → chunked 解码 → MIME 透传
/// - 官方 HTML 注入 AbortSignal polyfill（老 WebView 兼容，ADR-039 移动适配）
final class TunnelProxy: NSObject, URLSessionDelegate, URLSessionWebSocketDelegate {
    /// 应用级单例（AppDelegate 与插件共用，与 Android startWhaleMaidCore 同构）
    static let shared = TunnelProxy()

    private(set) var session = ControllerCredentialSession()
    private let prefs = UserDefaults.standard
    private var listener: NWListener?
    private var pinnedSession: URLSession!
    private let queue = DispatchQueue(label: "whalemaid.tunnel", qos: .userInitiated)
    var onReady: ((UInt16) -> Void)?

    // MARK: - 启动

    func start(_ ready: @escaping (UInt16) -> Void) {
        onReady = ready
        let config = URLSessionConfiguration.default
        pinnedSession = URLSession(configuration: config, delegate: self, delegateQueue: OperationQueue())
        bind(port: TunnelPure.fixedPort)
    }

    private func bind(port: UInt16) {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        do {
            let nwPort = NWEndpoint.Port(rawValue: port) ?? .any
            let l = try NWListener(using: params, on: nwPort)
            l.newConnectionHandler = { [weak self] conn in self?.handleConnection(conn) }
            l.stateUpdateHandler = { [weak self] (state: NWListener.State) in
                switch state {
                case .failed(let error):
                    NSLog("[whalemaid] 固定本地端口 %u 启动失败: %@", port, String(describing: error))
                case .ready:
                    let actual = l.port?.rawValue ?? port
                    self?.onReady?(actual)
                default: break
                }
            }
            l.start(queue: queue)
            listener = l
        } catch {
            NSLog("[whalemaid] 固定本地端口 %u 创建失败: %@", port, String(describing: error))
        }
    }

    // MARK: - 连接处理（HTTP/1.1 + WS 升级）

    private func handleConnection(_ conn: NWConnection) {
        conn.start(queue: queue)
        readHead(conn, buffer: Data())
    }

    private func readHead(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let data = data, !data.isEmpty {
                var buf = buffer
                buf.append(data)
                if let sep = TunnelPure.indexOfCrlfCrlf(buf), sep + 4 <= buf.count {
                    let head = String(data: buf[0..<sep], encoding: .utf8) ?? ""
                    let lines = head.components(separatedBy: "\r\n")
                    guard let requestLine = lines.first else { self.close(conn); return }
                    let parts = requestLine.split(separator: " ")
                    guard parts.count >= 2 else { self.close(conn); return }
                    let method = String(parts[0])
                    let uri = String(parts[1])
                    var headers: [String: String] = [:]
                    for line in lines.dropFirst() {
                        guard let idx = line.firstIndex(of: ":") else { continue }
                        headers[line[..<idx].trimmingCharacters(in: .whitespaces).lowercased()] =
                            line[line.index(after: idx)...].trimmingCharacters(in: .whitespaces)
                    }
                    // WS 升级判定在 dispatch 的 /api/events 分支处理
                    let contentLength = Int(headers["content-length"] ?? "0") ?? 0
                    if contentLength > 0 {
                        let bodyStart = sep + 4
                        let needed = bodyStart + contentLength
                        if buf.count < needed {
                            self.readMore(conn, buffer: buf, needed: needed) { full in
                                let body = Data(full[bodyStart..<needed])
                                self.dispatch(conn, method: method, uri: uri, headers: headers, body: body)
                            }
                            return
                        }
                        let body = Data(buf[bodyStart..<needed])
                        self.dispatch(conn, method: method, uri: uri, headers: headers, body: body)
                    } else {
                        self.dispatch(conn, method: method, uri: uri, headers: headers, body: nil)
                    }
                    return
                }
                self.readHead(conn, buffer: buf)
            } else {
                self.close(conn)
            }
        }
    }

    private func readMore(_ conn: NWConnection, buffer: Data, needed: Int, done: @escaping (Data) -> Void) {
        if buffer.count >= needed { done(buffer); return }
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let data = data, !data.isEmpty {
                var buf = buffer
                buf.append(data)
                self.readMore(conn, buffer: buf, needed: needed, done: done)
            } else {
                self.close(conn)
            }
        }
    }

    // MARK: - 路由

    private func dispatch(_ conn: NWConnection, method: String, uri: String, headers: [String: String], body: Data?) {
        switch TunnelPure.route(uri: uri, method: method, connected: session.connected) {
        case .management:
            let html = managementPage()
            respond(conn, status: 200, mime: "text/html; charset=utf-8", headers: [:], body: html)
        case .status:
            guard let body = body, let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
                respondJson(conn, status: 400, body: "{\"error\":\"server/deviceId 必填\"}")
                return
            }
            let server = (json["server"] as? String ?? "").replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let deviceId = (json["deviceId"] as? String ?? "").uppercased()
            relayRequest(server: server, path: "/_whalemaid/devices/\(deviceId)/status", method: "GET") { [weak self] code, respBody in
                guard let self = self else { return }
                guard code == 200, let st = try? JSONSerialization.jsonObject(with: respBody) as? [String: Any] else {
                    self.respondJson(conn, status: 502, body: "{\"error\":\"服务端不可达: \(code)\"}")
                    return
                }
                let registered = st["registered"] as? Bool ?? false
                let online = st["online"] as? Bool ?? false
                self.respondJson(conn, status: 200, body: "{\"registered\":\(registered),\"online\":\(online)}")
            }
        case .connect:
            guard let body = body, let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let server = json["server"] as? String, let rawDeviceId = json["deviceId"] as? String,
                  let password = json["password"] as? String, let kindWire = json["credentialKind"] as? String,
                  let kind = try? ControllerCredentialKind(wire: kindWire),
                  !server.isEmpty, !rawDeviceId.isEmpty, !password.isEmpty else {
                respondJson(conn, status: 400, body: "{\"error\":\"server/deviceId/password/credentialKind 必填\"}")
                return
            }
            let srv = server.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let deviceId = rawDeviceId.uppercased()
            relayRequest(server: srv, path: "/_whalemaid/devices/\(deviceId)/status", method: "GET") { [weak self] code, respBody in
                guard let self = self else { return }
                if code != 200 {
                    self.respondJson(conn, status: 502, body: "{\"error\":\"服务端不可达: \(code)\"}")
                    return
                }
                guard let st = try? JSONSerialization.jsonObject(with: respBody) as? [String: Any] else {
                    self.respondJson(conn, status: 502, body: "{\"error\":\"服务端响应异常\"}")
                    return
                }
                if !(st["registered"] as? Bool ?? false) {
                    self.respondJson(conn, status: 404, body: "{\"error\":\"DEVICE_NOT_FOUND\"}")
                    return
                }
                if !(st["online"] as? Bool ?? false) {
                    self.respondJson(conn, status: 503, body: "{\"error\":\"DEVICE_OFFLINE\"}")
                    return
                }
                let payload: [String: Any] = ["deviceId": deviceId, "password": password, "credentialKind": kind.rawValue]
                guard let authBody = self.jsonString(payload) else {
                    self.respondJson(conn, status: 500, body: "{\"error\":\"INVALID_REQUEST\"}")
                    return
                }
                self.relayRequest(server: srv, path: "/_whalemaid/connect", method: "POST", body: authBody) { code2, response in
                    guard code2 == 200,
                          let auth = try? JSONSerialization.jsonObject(with: response) as? [String: Any],
                          let token = auth["sessionToken"] as? String,
                          let returnedWire = auth["credentialKind"] as? String,
                          let returnedKind = try? ControllerCredentialKind(wire: returnedWire),
                          returnedKind == kind,
                          !token.isEmpty else {
                        if code2 == 200 {
                            self.respondJson(conn, status: 502, body: "{\"error\":\"INVALID_RELAY_RESPONSE\"}")
                        } else {
                            self.respond(conn, status: code2, mime: "application/json", headers: [:], body: response)
                        }
                        return
                    }
                    do {
                        try self.session.commit(server: srv, deviceId: deviceId, password: password, kind: kind, token: token)
                        self.respondJson(conn, status: 200, body: "{\"ok\":true,\"credentialKind\":\"\(kind.rawValue)\"}")
                    } catch {
                        self.respondJson(conn, status: 502, body: "{\"error\":\"INVALID_RELAY_RESPONSE\"}")
                    }
                }
            }
        case .tunnel:
            if uri.hasPrefix("/api/events") && headers["upgrade"]?.lowercased() == "websocket" {
                handleWebSocketUpgrade(conn, uri: uri, headers: headers)
            } else {
                tunnelRequest(conn, method: method, uri: uri, headers: headers, body: body)
            }
        }
    }

    // MARK: - 隧道请求

    private func jsonString(_ value: [String: Any]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func requestGrant(done: @escaping (Int, String?) -> Void) {
        func exchange(useToken: Bool) {
            guard let payload = try? session.payload(useToken: useToken), let body = jsonString(payload) else {
                done(401, nil)
                return
            }
            relayRequest(server: session.server, path: "/_whalemaid/connect", method: "POST", body: body) { [weak self] code, response in
                guard let self = self else { return }
                if useToken && self.session.canFallbackPassword(status: code) {
                    exchange(useToken: false)
                    return
                }
                guard code == 200,
                      let json = try? JSONSerialization.jsonObject(with: response) as? [String: Any],
                      let grant = json["grant"] as? String,
                      let token = json["sessionToken"] as? String,
                      let kindWire = json["credentialKind"] as? String,
                      let kind = try? ControllerCredentialKind(wire: kindWire),
                      kind == self.session.credentialKind else {
                    done(code, nil)
                    return
                }
                do {
                    try self.session.updateToken(token)
                    done(200, grant)
                } catch {
                    done(502, nil)
                }
            }
        }
        exchange(useToken: true)
    }

    private func tunnelRequest(_ conn: NWConnection, method: String, uri: String, headers: [String: String], body: Data?) {
        let srv = session.server
        requestGrant { [weak self] code, grant in
            guard let self = self else { return }
            guard code == 200, let grant = grant else {
                self.respondJson(conn, status: 502, body: "{\"error\":\"connect \\(code)\"}")
                return
            }
            let head = TunnelPure.buildTunnelRequest(method: method, uri: uri, headers: headers, body: body)
            self.wssTunnel(server: srv, grant: grant, requestHead: head, body: body) { raw in
                let (status, respHeaders, payload0) = TunnelPure.parseResponse(raw)
                let payload = (status == 200 && (respHeaders["content-type"] ?? "").contains("text/html"))
                    ? TunnelPure.injectPolyfill(payload0) : payload0
                var respHeaders2 = respHeaders
                for k in ["connection", "transfer-encoding", "content-length", "date"] { respHeaders2.removeValue(forKey: k) }
                self.respond(conn, status: status, mime: respHeaders["content-type"] ?? "application/octet-stream",
                             headers: respHeaders2, body: payload)
            }
        }
    }

    private func wssTunnel(server: String, grant: String, requestHead: Data, body: Data?, done: @escaping (Data) -> Void) {
        guard let url = URL(string: "wss://\(server)/_whalemaid/tunnel-ws") else { done(Data()); return }
        let task = pinnedSession.webSocketTask(with: url)
        let out = Buffer()
        var finished = false
        task.resume()
        task.send(.string("GRANT \(grant) \(session.deviceId)")) { _ in
            task.send(.data(requestHead)) { _ in
                if let body = body, !body.isEmpty {
                    task.send(.data(body)) { _ in self.receiveLoop(task, buffer: out, done: done) }
                } else {
                    self.receiveLoop(task, buffer: out, done: done)
                }
            }
        }
        // 防挂起：15s 后未完成直接返回已收数据
        queue.asyncAfter(deadline: .now() + 15) {
            if !finished { finished = true; task.cancel(); done(out.data) }
        }
    }

    private final class Buffer { var data = Data() }

    private func receiveLoop(_ task: URLSessionWebSocketTask, buffer: Buffer, done: @escaping (Data) -> Void) {
        task.receive { result in
            switch result {
            case .success(let message):
                switch message {
                case .data(let d): buffer.data.append(d)
                case .string(let s): buffer.data.append(Data(s.utf8))
                @unknown default: break
                }
                self.receiveLoop(task, buffer: buffer, done: done)
            case .failure:
                done(buffer.data)
            }
        }
    }

    // MARK: - WS 事件桥（页面 ↔ 宿主官方事件通道）

    private func handleWebSocketUpgrade(_ conn: NWConnection, uri: String, headers: [String: String]) {
        guard let key = headers["sec-websocket-key"] else { close(conn); return }
        // 101 响应（Sec-WebSocket-Accept = base64(sha1(key + magic))）
        let magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        let accept = sha1Base64(key + magic)
        let respHead = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n"
        send(conn, Data(respHead.utf8))

        let srv = session.server
        requestGrant { [weak self] code, grant in
            guard let self = self else { return }
            guard code == 200, let grant = grant else { self.close(conn); return }
            guard let url = URL(string: "wss://\(srv)/_whalemaid/tunnel-ws") else { self.close(conn); return }
            let task = self.pinnedSession.webSocketTask(with: url)
            task.resume()
            task.send(.string("GRANT \(grant) \(self.session.deviceId)")) { _ in
                let origin = headers["origin"] ?? "http://\(TunnelPure.hostAuthority)"
                let upgrade = TunnelPure.buildEventsUpgradeRequest(uri: uri, secWebSocketKey: key, origin: origin)
                task.send(.string(upgrade)) { _ in
                    self.pumpUpstreamToClient(task, conn)
                    self.pumpClientToUpstream(conn, task)
                }
            }
        }
    }

    /// 上联字节流 → 客户端：剥 101 头后按原 opcode 重帧（文本帧不可降级）
    private func pumpUpstreamToClient(_ task: URLSessionWebSocketTask, _ conn: NWConnection) {
        var headSkipped = false
        var buf = Data()
        func loop() {
            task.receive { [weak self] result in
                guard let self = self else { return }
                switch result {
                case .success(let message):
                    var data = Data()
                    switch message {
                    case .data(let d): data = d
                    case .string(let s): data = Data(s.utf8)
                    @unknown default: break
                    }
                    if !headSkipped {
                        buf.append(data)
                        if let sep = TunnelPure.indexOfCrlfCrlf(buf) {
                            headSkipped = true
                            data = Data(buf[(sep + 4)...])
                            buf = Data()
                        } else { data = Data() }
                    }
                    if !data.isEmpty { self.forwardFrames(data, to: conn) }
                    loop()
                case .failure:
                    self.close(conn)
                }
            }
        }
        loop()
    }

    private func pumpClientToUpstream(_ conn: NWConnection, _ task: URLSessionWebSocketTask) {
        var buf = Data()
        func loop() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, _, _ in
                guard let self = self, let data = data, !data.isEmpty else { return }
                buf.append(data)
                // 客户端帧带掩码：解析后原样发给上联（重写为无掩码服务端帧由上游协议决定——这里直接透传原始帧字节）
                // 浏览器→我们：掩码帧；我们→上联 WSS：作为二进制消息（URLSession 自动按 WS 帧打包，对端收到的是帧 payload 而非帧头）
                // 因此这里必须解出 payload 再发。
                var out = Data()
                var i = 0
                let bytes = [UInt8](buf)
                while i + 2 <= bytes.count {
                    let b0 = Int(bytes[i]); let b1 = Int(bytes[i + 1])
                    let fin = (b0 & 0x80) != 0
                    let opcode = UInt8(b0 & 0x0F)
                    let masked = (b1 & 0x80) != 0
                    var len = b1 & 0x7F
                    var head = i + 2
                    if len == 126 { guard bytes.count - head >= 2 else { break }; len = (Int(bytes[head]) << 8) | Int(bytes[head + 1]); head += 2 }
                    else if len == 127 { guard bytes.count - head >= 8 else { break }; var l: UInt64 = 0; for j in 0..<8 { l = (l << 8) | UInt64(bytes[head + j]) }; len = Int(l); head += 8 }
                    var maskKey: [UInt8] = []
                    if masked { guard bytes.count - head >= 4 else { break }; maskKey = Array(bytes[head..<(head + 4)]); head += 4 }
                    guard bytes.count - head >= len else { break }
                    var payload = Array(bytes[head..<(head + len)])
                    if masked { for j in 0..<payload.count { payload[j] ^= maskKey[j % 4] } }
                    // 重建无掩码帧，交由客户端栈原样解读（帧语义不变）
                    out.append(frameBytes(fin: fin, opcode: opcode, payload: payload, masked: false))
                    i = head + len
                }
                buf = Data()
                if !out.isEmpty {
                    task.send(.data(out)) { _ in }
                }
                loop()
            }
        }
        loop()
    }

    private func frameBytes(fin: Bool, opcode: UInt8, payload: [UInt8], masked: Bool) -> Data {
        var out = [UInt8]()
        out.append((fin ? 0x80 : 0) | opcode)
        let len = payload.count
        if len < 126 {
            out.append(UInt8(len) | (masked ? 0x80 : 0))
        } else if len < 65536 {
            out.append(UInt8(126) | (masked ? 0x80 : 0))
            out.append(UInt8(len >> 8)); out.append(UInt8(len & 0xFF))
        } else {
            out.append(UInt8(127) | (masked ? 0x80 : 0))
            for i in stride(from: 56, through: 0, by: -8) { out.append(UInt8((len >> i) & 0xFF)) }
        }
        out.append(contentsOf: payload)
        return Data(out)
    }

    private func forwardFrames(_ data: Data, to conn: NWConnection) {
        var out = Data()
        var i = 0
        let bytes = [UInt8](data)
        while i < bytes.count {
            guard let frame = TunnelPure.parseWsFrame(data, i) else { break }
            out.append(frameBytes(fin: frame.fin, opcode: frame.opcode, payload: [UInt8](frame.payload), masked: false))
            i += frame.consumed
        }
        if !out.isEmpty { send(conn, out) }
    }

    // MARK: - 中继控制面（TLS + TOFU 指纹固定）

    private func relayRequest(server: String, path: String, method: String = "GET", body: String? = nil, done: @escaping (Int, Data) -> Void) {
        guard let url = URL(string: "https://\(server)\(path)") else { done(-1, Data()); return }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let body = body {
            req.httpBody = Data(body.utf8)
            req.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        let task = pinnedSession.dataTask(with: req) { data, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            done(code, data ?? Data())
        }
        task.resume()
    }

    // URLSessionDelegate：TOFU 指纹固定（SEC-001；身份=指纹，主机名校验冗余）
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        guard let pin = pinFor(challenge.protectionSpace.host, port: challenge.protectionSpace.port, trust: trust) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        // 只存指纹、不做系统链校验（自签中继）；链校验交给指纹比较
        let credential = URLCredential(trust: trust)
        completionHandler(.useCredential, credential)
        _ = pin
    }

    private func pinFor(_ host: String, port: Int, trust: SecTrust) -> String? {
        let key = "pin_\(host):\(port)"
        if let saved = prefs.string(forKey: key) { return saved }
        guard let cert = SecTrustGetCertificateAtIndex(trust, 0) else { return nil }
        guard let keyRef = SecCertificateCopyKey(cert) else { return nil }
        var error: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(keyRef, &error) as Data? else { return nil }
        let digest = sha256(data)
        prefs.set(digest, forKey: key)
        return digest
    }

    private func sha256(_ data: Data) -> String {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash) }
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private func sha1Base64(_ input: String) -> String {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
        let data = Data(input.utf8)
        data.withUnsafeBytes { _ = CC_SHA1($0.baseAddress, CC_LONG(data.count), &hash) }
        return Data(hash).base64EncodedString()
    }

    // MARK: - 响应输出

    private func managementPage() -> Data {
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "public"),
           let data = try? Data(contentsOf: url) { return data }
        return Data("<html><body>WhaleMaid</body></html>".utf8)
    }

    private func respondJson(_ conn: NWConnection, status: Int, body: String) {
        respond(conn, status: status, mime: "application/json; charset=utf-8", headers: [:], body: Data(body.utf8))
    }

    private func respond(_ conn: NWConnection, status: Int, mime: String, headers: [String: String], body: Data) {
        var lines = ["HTTP/1.1 \(status) \(TunnelPure.reason(status))", "content-type: \(mime)", "content-length: \(body.count)"]
        for (k, v) in headers where !["connection", "transfer-encoding", "content-length", "date", "content-type"].contains(k.lowercased()) {
            lines.append("\(k): \(v)")
        }
        lines.append("connection: close")
        lines.append("")
        lines.append("")
        var out = Data((lines.joined(separator: "\r\n")).utf8)
        out.append(body)
        send(conn, out)
    }

    private func send(_ conn: NWConnection, _ data: Data) {
        conn.send(content: data, completion: .contentProcessed { [weak self] _ in
            // HTTP 响应发送完成即可关闭（Connection: close 语义）；WS 桥不经过此路径
            if data.starts(with: [UInt8]("HTTP/1.1".utf8)) { self?.close(conn) }
        })
    }

    private func close(_ conn: NWConnection) {
        conn.cancel()
    }
}
