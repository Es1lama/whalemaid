// SPEC: docs/adr/INDEX.md#ADR-033 设备密钥：Keychain SecKey ECDSA P-256（不可导出，原生等价 WebCrypto）
import Foundation
import Security

public enum DeviceKey {
  private static let tag = "dev.whalemaid.device-key".data(using: .utf8)!

  private static var query: [String: Any] {
    [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag, kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecReturnRef as String: true]
  }

  public static func getOrCreateKeyPair() throws -> SecKey {
    var item: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let key = item as! SecKey? {
      return key
    }
    let attrs: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave, // 硬件级不可导出
      kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: tag],
    ]
    guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, nil) else {
      throw NSError(domain: "whalemaid", code: 1, userInfo: [NSLocalizedDescriptionKey: "生成设备密钥失败"])
    }
    return key
  }

  /// JWK（PROTO-003）：从 SecKey 公钥提取 x/y（base64url 无填充）
  public static func publicJwk(_ privateKey: SecKey) throws -> [String: String] {
    guard let pub = SecKeyCopyPublicKey(privateKey),
          let data = SecKeyCopyExternalRepresentation(pub, nil) as Data? else {
      throw NSError(domain: "whalemaid", code: 2)
    }
    let x = data.subdata(in: 1..<33)
    let y = data.subdata(in: 33..<65)
    return ["kty": "EC", "crv": "P-256", "x": x.base64URL(), "y": y.base64URL()]
  }

  /// 挑战-应答签名（TM-004）：SHA256 ECDSA，base64
  public static func signNonce(_ privateKey: SecKey, nonce: String) throws -> String {
    let data = Data(nonce.utf8)
    var error: Unmanaged<CFError>?
    guard let sig = SecKeyCreateSignature(privateKey, .ecdsaSignatureMessageX962SHA256, data as CFData, &error) as Data? else {
      throw error?.takeRetainedValue() ?? NSError(domain: "whalemaid", code: 3)
    }
    return sig.base64EncodedString()
  }
}

private extension Data {
  func base64URL() -> String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}
