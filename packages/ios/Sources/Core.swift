// SPEC: docs/protocol.md 纯逻辑核心（可单测，无 UI 依赖）
import Foundation

public let whaleProtocolVersion = 1

// SPEC: docs/protocol.md#PROTO-003 设备 ID 格式
public enum DeviceIds {
  private static let pattern = try! NSRegularExpression(pattern: "^WHALE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$")
  public static func isValid(_ id: String) -> Bool {
    pattern.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil
  }
}

// SPEC: docs/requirements.md#REQ-010 目录模式
public struct TocItem: Identifiable, Equatable {
  public let level: Int
  public let title: String
  public var id: String { "\(level)-\(title)" }
}

public func tocFromText(_ text: String) -> [TocItem] {
  text.components(separatedBy: "\n").compactMap { line in
    guard let m = line.range(of: "^(#{1,4})\\s+(.+)$", options: .regularExpression) else { return nil }
    let rest = String(line[m].drop(while: { $0 == "#" || $0 == " " }))
    let level = line.prefix(while: { $0 == "#" }).count
    return TocItem(level: level, title: String(rest.prefix(60)))
  }
}

// SPEC: docs/protocol.md#PROTO-001 信封
public struct Envelope {
  public static func request(method: String, payload: [String: Any]) -> [String: Any] {
    ["v": whaleProtocolVersion, "rpcId": UUID().uuidString, "method": method, "payload": payload]
  }

  public enum ParseError: Error {
    case rpc(code: String, message: String)
    case malformed
  }

  public static func parseResponse(_ data: Data) throws -> [String: Any] {
    guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ParseError.malformed }
    if obj["ok"] as? Bool == true {
      return (obj["data"] as? [String: Any]) ?? [:]
    }
    let err = (obj["error"] as? [String: Any]) ?? [:]
    throw ParseError.rpc(code: err["code"] as? String ?? "server-error", message: err["message"] as? String ?? "unknown")
  }
}

// 从 DSH HistoryEntry 尽力提取文本（与 Web/Android 端同策略）
public func extractText(_ value: Any, depth: Int = 0) -> [String] {
  if let s = value as? String { return [s] }
  guard depth <= 3 else { return [] }
  var out: [String] = []
  if let obj = value as? [String: Any] {
    for (k, v) in obj where ["content", "text", "delta", "title", "name", "prompt", "message"].contains(k) {
      out.append(contentsOf: extractText(v, depth: depth + 1))
    }
  } else if let arr = value as? [Any] {
    for v in arr { out.append(contentsOf: extractText(v, depth: depth + 1)) }
  }
  return out
}
