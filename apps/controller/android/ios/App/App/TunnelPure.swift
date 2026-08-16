import Foundation

/// 纯逻辑工具（与 Android 侧 TunnelHttp 同语义；JVM 单测已覆盖相同规则，此处为 iOS 移植）
/// SPEC: docs/protocol.md#PROTO-001/008
enum TunnelPure {
    static let hostAuthority = "127.0.0.1:3181"
    static let ctrlConnectPath = "/_ctrl/connect"
    static let ctrlStatusPath = "/_ctrl/status"
    static let fixedPort: UInt16 = 43969
    static let maxBody = 64 * 1024 * 1024

    enum Route { case management, connect, status, tunnel }

    /// 路由决策：与 Android TunnelHttp.route 完全一致
    static func route(uri: String, method: String, connected: Bool) -> Route {
        if uri == ctrlConnectPath && method == "POST" { return .connect }
        if uri == ctrlStatusPath && method == "POST" && !connected { return .status }
        if uri == "/" && method == "GET" && !connected { return .management }
        return .tunnel
    }

    /// 中继控制面端口 = server 串实际端口；缺省 9080
    static func controlPort(of server: String) -> UInt16 {
        let parts = server.split(separator: ":", maxSplits: 1)
        if parts.count == 2, let p = UInt16(parts[1].split(separator: "/").first ?? "") { return p }
        return 9080
    }

    /// 上游 WS 字节流帧解析（server→client 无掩码）
    struct WsFrame {
        let fin: Bool
        let opcode: UInt8
        let payload: Data
        let consumed: Int
    }

    static func parseWsFrame(_ buf: Data, _ offset: Int = 0) -> WsFrame? {
        let bytes = [UInt8](buf)
        if bytes.count - offset < 2 { return nil }
        let b0 = Int(bytes[offset])
        let b1 = Int(bytes[offset + 1])
        let fin = (b0 & 0x80) != 0
        let opcode = UInt8(b0 & 0x0F)
        let masked = (b1 & 0x80) != 0
        if masked { return nil } // 服务端帧不应掩码；协议违例（上层按异常处理）
        var len = b1 & 0x7F
        var head = offset + 2
        if len == 126 {
            guard bytes.count - head >= 2 else { return nil }
            len = (Int(bytes[head]) << 8) | Int(bytes[head + 1])
            head += 2
        } else if len == 127 {
            guard bytes.count - head >= 8 else { return nil }
            var l: UInt64 = 0
            for i in 0..<8 { l = (l << 8) | UInt64(bytes[head + i]) }
            guard l <= UInt64(Int.max) else { return nil }
            len = Int(l)
            head += 8
        }
        guard bytes.count - head >= len else { return nil }
        let payload = Data(bytes[head..<(head + len)])
        return WsFrame(fin: fin, opcode: opcode, payload: payload, consumed: head + len - offset)
    }

    /// 隧道内 HTTP 请求行（Host/Origin 改写宿主权威；hop 头剔除；有 body 补 content-length）
    static func buildTunnelRequest(method: String, uri: String, headers: [String: String], body: Data?) -> Data {
        var lines: [String] = ["\(method) \(uri) HTTP/1.1", "Host: \(hostAuthority)", "Origin: http://\(hostAuthority)"]
        let hopByHop: Set<String> = ["host", "connection", "content-length", "origin", "upgrade", "accept-encoding"]
        for (k, v) in headers where !hopByHop.contains(k.lowercased()) {
            lines.append("\(k): \(v)")
        }
        if let body = body, !body.isEmpty { lines.append("content-length: \(body.count)") }
        lines.append("Connection: close")
        lines.append("")
        lines.append("")
        return Data((lines.joined(separator: "\r\n")).utf8)
    }

    /// 解析隧道上游 HTTP 响应：状态码/小写头/chunked 解码；无分隔符 → 502
    static func parseResponse(_ raw: Data) -> (status: Int, headers: [String: String], body: Data) {
        guard let sep = indexOfCrlfCrlf(raw) else { return (502, [:], raw) }
        let head = String(data: raw[0..<sep], encoding: .utf8) ?? ""
        var body = Data(raw[(sep + 4)...])
        let lines = head.components(separatedBy: "\r\n")
        let status: Int = {
            guard let first = lines.first else { return 502 }
            let parts = first.split(separator: " ")
            guard parts.count >= 2, let code = Int(parts[1]) else { return 502 }
            return code
        }()
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let idx = line.firstIndex(of: ":") else { continue }
            let k = line[..<idx].trimmingCharacters(in: .whitespaces).lowercased()
            let v = line[line.index(after: idx)...].trimmingCharacters(in: .whitespaces)
            headers[k] = v
        }
        if headers["transfer-encoding"]?.lowercased() == "chunked" {
            body = decodeChunked(body)
        }
        return (status, headers, body)
    }

    static func decodeChunked(_ buf: Data) -> Data {
        var out = Data()
        var i = 0
        let bytes = [UInt8](buf)
        while i < bytes.count {
            guard let lineEnd = (i..<bytes.count).first(where: { bytes[$0] == 13 /*\r*/ }) else { break }
            let sizeStr = String(data: Data(bytes[i..<lineEnd]), encoding: .ascii)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !sizeStr.isEmpty, let size = Int(sizeStr, radix: 16), size > 0 else { break }
            let start = lineEnd + 2
            guard start + size <= bytes.count else { break }
            out.append(Data(bytes[start..<(start + size)]))
            i = start + size + 2
        }
        return out
    }

    static func indexOfCrlfCrlf(_ data: Data) -> Int? {
        let bytes = [UInt8](data)
        for i in 0..<(bytes.count - 3) {
            if bytes[i] == 13, bytes[i + 1] == 10, bytes[i + 2] == 13, bytes[i + 3] == 10 { return i }
        }
        return nil
    }

    /// 官方事件通道 WS upgrade 请求行（页面实际 URI + Origin 透传）
    static func buildEventsUpgradeRequest(uri: String, secWebSocketKey: String, origin: String?) -> String {
        let originLine = (origin == nil || origin!.isEmpty) ? "" : "Origin: \(origin!)\r\n"
        return "GET \(uri) HTTP/1.1\r\nHost: \(hostAuthority)\r\n\(originLine)" +
            "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: \(secWebSocketKey)\r\nSec-WebSocket-Version: 13\r\n\r\n"
    }

    /// 老 WebView polyfill（与 Android ProxyCore.POLYFILL_SCRIPT 同内容）
    static let polyfillScript = """
    <script id="whalemaid-polyfill">
    (function () {
      if (typeof AbortSignal === 'undefined') return;
      if (!AbortSignal.any) {
        AbortSignal.any = function (signals) {
          var list = signals || [];
          var c = new AbortController();
          if (list.some(function (s) { return s && s.aborted; })) { c.abort(); return c.signal; }
          list.forEach(function (s) {
            if (!s) return;
            s.addEventListener('abort', function () { c.abort(s.reason); }, { once: true });
          });
          return c.signal;
        };
      }
      if (!AbortSignal.timeout) {
        AbortSignal.timeout = function (ms) {
          var c = new AbortController();
          var t = setTimeout(function () { c.abort(new DOMException('TimeoutError', 'TimeoutError')); }, ms);
          if (t && typeof t.unref === 'function') t.unref();
          return c.signal;
        };
      }
    })();
    </script>
    """

    static func injectPolyfill(_ html: Data) -> Data {
        guard var text = String(data: html, encoding: .utf8), !text.contains("whalemaid-polyfill"),
              let headRange = text.range(of: "<head") else { return html }
        let insertAt = text[headRange.upperBound...].firstIndex(of: ">").map { text.index(after: $0) }
        if let at = insertAt {
            text.insert(contentsOf: polyfillScript, at: at)
        }
        return Data(text.utf8)
    }

    /// HTTP 状态原因短语（自建 HTTP 服务器用）
    static func reason(_ code: Int) -> String {
        switch code {
        case 200: return "OK"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 429: return "Too Many Requests"
        case 500: return "Internal Server Error"
        case 502: return "Bad Gateway"
        case 503: return "Service Unavailable"
        default: return "Status"
        }
    }
}
