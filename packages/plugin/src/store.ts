// SPEC: docs/protocol.md#PROTO-003/009 凭据与吊销存储
// SPEC: docs/threat-model.md#TM-003/005/011（token 只存摘要；吊销名单；审计只记元数据）
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { generateDeviceId, generatePassword } from './device.js'

export interface AuthorizedDevice {
  deviceId: string
  publicKeyJwk: JsonWebKey
  tokenDigest: string
  createdAt: number
  /** SEC-004：会话 token 短 TTL + 滑动续期 */
  expiresAt: number
  lastUsedAt: number
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
  /** SEC-001/UX-002：受控端持久设备编号（WHALE-XXXX-XXXX） */
  deviceId: string
  /** 服务端签发的每设备凭据（自动注册后保存，SEC-001） */
  relayCredential: string
  pendingNonces: Record<string, { deviceId: string; publicKeyJwk: JsonWebKey; expiresAt: number }>
  devices: AuthorizedDevice[]
  tempTokens: TempToken[]
  /** 一次性/限时临时密码（REQ-003）：宿主生成、用完即焚 */
  tempPasswords: Array<{ password: string; expiresAt: number }>
  audit: Array<{ at: number; deviceId: string; method: string; ok: boolean }>
}

/** SEC-004：网关会话 token 有效期（滑动续期窗口） */
export const TOKEN_TTL_MS = 10 * 60_000

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class Store {
  private state: StoreState
  private path: string

  constructor(dataDir?: string) {
    // 默认随 DSH_HOME 走（profile 隔离），无 DSH_HOME 时退回 ~/.dsh/whalemaid
    const base = dataDir || join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'whalemaid')
    this.path = join(base, 'store.json')
    mkdirSync(base, { recursive: true })
    this.state = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, 'utf8')) as StoreState)
      : {
          longPassword: this.newPassword(),
          deviceId: generateDeviceId(),
          relayCredential: '',
          pendingNonces: {},
          devices: [],
          tempTokens: [],
          tempPasswords: [],
          audit: [],
        }
    this.state.tempPasswords ??= []
    this.state.relayCredential ??= ''
    this.state.deviceId ??= generateDeviceId()
    this.persist() // 初始状态（含生成的长期密码与设备编号）立即落盘
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

  /** UX-002：受控端设备编号（主界面展示） */
  get deviceId(): string {
    return this.state.deviceId
  }

  get relayCredential(): string {
    return this.state.relayCredential
  }

  setRelayCredential(value: string): void {
    this.state.relayCredential = value
    this.persist()
  }

  rotatePassword(): string {
    this.state.longPassword = this.newPassword()
    this.state.devices = [] // 改密=吊销全部设备（REQ-002）
    this.state.tempTokens = []
    this.persist()
    return this.state.longPassword
  }

  /** 握手时登记：nonce 绑定设备与公钥（绑定流程验签用，TM-004） */
  addNonce(deviceId: string, publicKeyJwk: JsonWebKey, ttlMs = 60_000): string {
    const nonce = randomBytes(16).toString('base64url')
    this.state.pendingNonces[nonce] = { deviceId, publicKeyJwk, expiresAt: Date.now() + ttlMs }
    this.persist()
    return nonce
  }

  takeNonce(nonce: string): { deviceId: string; publicKeyJwk: JsonWebKey } | null {
    const entry = this.state.pendingNonces[nonce]
    if (!entry || entry.expiresAt < Date.now()) return null
    delete this.state.pendingNonces[nonce] // 一次性（TM-004）
    this.persist()
    return entry
  }

  issueToken(deviceId: string, ttlMs = TOKEN_TTL_MS): string {
    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    this.state.devices.push({
      deviceId,
      publicKeyJwk: {} as JsonWebKey, // bind 时由路由回填
      tokenDigest: digest(token),
      createdAt: now,
      expiresAt: now + ttlMs,
      lastUsedAt: now,
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

  /** SEC-004：会话 token 校验——过期即失效，成功则滑动续期 */
  findDeviceByToken(token: string): AuthorizedDevice | undefined {
    const d = digest(token)
    const dev = this.state.devices.find((x) => x.tokenDigest === d && !x.revoked)
    if (!dev) return undefined
    const now = Date.now()
    if (dev.expiresAt <= now) return undefined
    dev.lastUsedAt = now
    dev.expiresAt = now + TOKEN_TTL_MS
    this.persist()
    return dev
  }

  /** 生成一次性/限时临时密码（REQ-003），默认 10 分钟 */
  issueTemporaryPassword(ttlMs = 10 * 60_000): string {
    const password = generatePassword()
    this.state.tempPasswords = this.state.tempPasswords.filter((p) => p.expiresAt > Date.now())
    this.state.tempPasswords.push({ password, expiresAt: Date.now() + ttlMs })
    this.persist()
    return password
  }

  /** 消费临时密码：一次性，用过即焚（REQ-003） */
  consumeTemporaryPassword(password: string): boolean {
    const idx = this.state.tempPasswords.findIndex((p) => p.password === password && p.expiresAt > Date.now())
    if (idx < 0) return false
    this.state.tempPasswords.splice(idx, 1)
    this.persist()
    return true
  }

  /** 签发短 TTL 临时 token（临时密码绑定所得），默认 12 小时 */
  issueTemporaryToken(deviceId: string, ttlMs = 12 * 3600_000): string {
    const token = randomBytes(32).toString('base64url')
    this.state.tempTokens = this.state.tempTokens.filter((t) => t.expiresAt > Date.now() && !t.used)
    this.state.tempTokens.push({ digest: digest(token), deviceId, expiresAt: Date.now() + ttlMs, used: false })
    this.persist()
    return token
  }

  /** 查找临时 token（验证一次有效，不消费） */
  findTemporaryToken(token: string): { deviceId: string } | undefined {
    const d = digest(token)
    const t = this.state.tempTokens.find((x) => x.digest === d && !x.used && x.expiresAt > Date.now())
    return t ? { deviceId: t.deviceId } : undefined
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
