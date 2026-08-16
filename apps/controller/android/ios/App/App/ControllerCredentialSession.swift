import Foundation

enum ControllerCredentialKind: String {
    case longTerm
    case temporary

    init(wire: String) throws {
        guard let value = ControllerCredentialKind(rawValue: wire) else {
            throw NSError(domain: "WhaleMaidCredential", code: 1, userInfo: [NSLocalizedDescriptionKey: "credentialKind must be longTerm or temporary"])
        }
        self = value
    }
}

struct ControllerCredentialSession {
    private(set) var server = ""
    private(set) var deviceId = ""
    private(set) var password = ""
    private(set) var sessionToken = ""
    private(set) var credentialKind: ControllerCredentialKind = .longTerm

    var connected: Bool { !server.isEmpty && !deviceId.isEmpty && !sessionToken.isEmpty }

    mutating func commit(server: String, deviceId: String, password: String, kind: ControllerCredentialKind, token: String) throws {
        guard !token.isEmpty else { throw NSError(domain: "WhaleMaidCredential", code: 2, userInfo: [NSLocalizedDescriptionKey: "relay response missing sessionToken"]) }
        self.server = server
        self.deviceId = deviceId
        self.password = kind == .longTerm ? password : ""
        self.credentialKind = kind
        self.sessionToken = token
    }

    mutating func updateToken(_ token: String) throws {
        guard !token.isEmpty else { throw NSError(domain: "WhaleMaidCredential", code: 4, userInfo: [NSLocalizedDescriptionKey: "relay response missing sessionToken"]) }
        sessionToken = token
    }

    func payload(useToken: Bool) throws -> [String: Any] {
        if useToken { return ["deviceId": deviceId, "sessionToken": sessionToken] }
        guard credentialKind == .longTerm, !password.isEmpty else {
            throw NSError(domain: "WhaleMaidCredential", code: 3, userInfo: [NSLocalizedDescriptionKey: "temporary credential cannot fall back to password"])
        }
        return ["deviceId": deviceId, "password": password, "credentialKind": ControllerCredentialKind.longTerm.rawValue]
    }

    func canFallbackPassword(status: Int) -> Bool {
        status == 401 && credentialKind == .longTerm && !password.isEmpty
    }
}
