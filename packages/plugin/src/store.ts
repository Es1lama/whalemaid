// SPEC: docs/protocol.md#PROTO-003/009 凭据与吊销存储
// SPEC: docs/threat-model.md#TM-003/005/011（token 只存摘要；吊销名单；审计只记元数据）
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { generatePassword } from './device.js'

export interface AuthorizedDevice {
  deviceId: string
  publicKeyJwk: JsonWebKey
  tokenDigest: string
  createdAt: number
  revoked: boolean
}

export interface TempToken {
  digest: string
  deviceId: string
  expiresAt: number
  used: boolean
}

export interface StoreState {
  longPassword: string
  pendingNonces: Record<string, { deviceId: string; expiresAt: number }>
  devices: AuthorizedDevice[]
  tempTokens: TempToken[]
  audit: Array<{ at: number; deviceId: string; method: string; ok: boolean }>
}

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class Store {
  private state: StoreState
  private path: string

  constructor(dataDir?: string) {
    const base = dataDir || join(homedir(), '.dsh', 'whalemaid')
    this.path = join(base, 'store.json')
    mkdirSync(base, { recursive: true })
    this.state = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, 'utf8')) as StoreState)
      : {
          longPassword: this.newPassword(),
          pendingNonces: {},
          devices: [],
          tempTokens: [],
          audit: [],
        }
  }

  /** 长期密码生成在构造时完成；插件设置页可触发重新生成（重生成=全量吊销，REQ-002） */
  private newPassword(): string {
    return generatePassword()
  }

  private persist(): void {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2), { mode: 0o600 })
  }

  get longPassword(): string {
    return this.state.longPassword
  }

  get file(): string {
    return this.path
  }

  rotatePassword(): string {
    this.state.longPassword = this.newPassword()
    this.state.devices = [] // 改密=吊销全部设备（REQ-002）
    this.state.tempTokens = []
    this.persist()
    return this.state.longPassword
  }

  addNonce(deviceId: string, ttlMs = 60_000): string {
    const nonce = randomBytes(16).toString('base64url')
    this.state.pendingNonces[nonce] = { deviceId, expiresAt: Date.now() + ttlMs }
    this.persist()
    return nonce
  }

  takeNonce(nonce: string): { deviceId: string } | null {
    const entry = this.state.pendingNonces[nonce]
    if (!entry || entry.expiresAt < Date.now()) return null
    delete this.state.pendingNonces[nonce] // 一次性（TM-004）
    this.persist()
    return entry
  }

  issueToken(deviceId: string): string {
    const token = randomBytes(32).toString('base64url')
    this.state.devices.push({
      deviceId,
      publicKeyJwk: {} as JsonWebKey, // bind 时由路由回填
      tokenDigest: digest(token),
      createdAt: Date.now(),
      revoked: false,
    })
    this.persist()
    return token
  }

  bindPublicKey(deviceId: string, jwk: JsonWebKey): void {
    const dev = this.state.devices.find((d) => d.deviceId === deviceId && !d.revoked)
    if (dev) {
      dev.publicKeyJwk = jwk
      this.persist()
    }
  }

  findDeviceByToken(token: string): AuthorizedDevice | undefined {
    const d = digest(token)
    return this.state.devices.find((x) => x.tokenDigest === d && !x.revoked)
  }

  revokeDevice(deviceId: string): void {
    const dev = this.state.devices.find((d) => d.deviceId === deviceId)
    if (dev) {
      dev.revoked = true
      this.persist()
    }
  }

  audit(deviceId: string, method: string, ok: boolean): void {
    this.state.audit.push({ at: Date.now(), deviceId, method, ok })
    if (this.state.audit.length > 1000) this.state.audit = this.state.audit.slice(-1000)
    this.persist()
  }
}
