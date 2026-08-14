// SPEC: docs/protocol.md#PROTO-003 认证与凭据
// SPEC: docs/adr/INDEX.md#ADR-033 设备密钥（WebCrypto ECDSA P-256 不可导出）

/** 设备 ID：宿主生成，形如 WHALE-XXXX-XXXX（排除易混字符） */
export const DEVICE_ID_PATTERN = /^WHALE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

export type DeviceId = string
export type Nonce = string
export type DeviceToken = string

export interface HandshakePayload {
  deviceId: DeviceId
  /** 客户端公钥（JWK，ECDSA P-256；私钥不可导出，见 ADR-033） */
  publicKeyJwk: JsonWebKey
}

export interface HandshakeData {
  nonce: Nonce
  caps: string[]
}

export interface BindPayload {
  deviceId: DeviceId
  /** 长期密码，仅绑定流程使用一次 */
  password: string
  /** ECDSA P-256 对 nonce 的签名（base64） */
  nonceSignature: string
}

export interface BindData {
  deviceToken: DeviceToken
}

export interface BindTemporaryPayload {
  deviceId: DeviceId
  /** 一次性/限时密码（REQ-003） */
  password: string
}

export interface BindTemporaryData {
  deviceToken: DeviceToken
  expiresAt: number
}

/** 认证头：Authorization: Bearer <deviceToken> */
export const AUTH_HEADER_PREFIX = 'Bearer '

/** CredentialVerifier 抽象（ADR-021）：宿主实现，客户端只消费类型 */
export interface CredentialVerifier {
  verify(request: { header?: string; method: string }): Promise<DeviceId | null>
}
