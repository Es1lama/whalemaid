// SPEC: docs/protocol.md PROTO-003 受控端持久状态：设备编号 + 长期密码 + 中继凭据（授权在中继侧，宿主本地不再保存配对状态）
// SPEC: docs/threat-model.md TM-003（凭据落盘 0600；不存明文 token 之外的任何会话状态）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateDeviceId, generatePassword } from './device.js'

export interface StoreState {
  /** SEC-002/UX-002：受控端长期密码（注册时只上报 scrypt PHC，明文只在宿主本地展示） */
  longPassword: string
  /** SEC-001/UX-002：受控端持久设备编号（WHALE-XXXX-XXXX） */
  deviceId: string
  /** 服务端签发的每设备凭据（自动注册后保存，SEC-001） */
  relayCredential: string
  /** 受控端本地管理令牌（密码轮换等本机操作；启动生成，打印到宿主日志） */
  adminToken: string
}

export interface StoreOptions {
  /** 显式数据目录用于受控部署；设置后高于 profile 默认目录。 */
  dataDir?: string
  /** DSH loader 为当前 profile 配置目录提供的 file URL（ctx.baseUrl）。 */
  profileBaseUrl?: string | URL
}

function resolveDataDir(options: StoreOptions): string {
  if (options.dataDir) return options.dataDir
  if (!options.profileBaseUrl) {
    throw new Error('WhaleMaid 身份缺少 profileBaseUrl：拒绝回退到共享 DSH_HOME；请由 DSH loader 提供 ctx.baseUrl 或显式配置 dataDir')
  }
  const profileUrl = options.profileBaseUrl instanceof URL
    ? options.profileBaseUrl
    : new URL(options.profileBaseUrl)
  if (profileUrl.protocol !== 'file:') {
    throw new Error(`WhaleMaid profileBaseUrl 必须是 file: URL，收到 ${profileUrl.protocol}`)
  }
  return join(fileURLToPath(profileUrl), 'whalemaid')
}

export class Store {
  private state: StoreState
  private path: string

  constructor(options: StoreOptions) {
    const base = resolveDataDir(options)
    this.path = join(base, 'store.json')
    mkdirSync(base, { recursive: true })
    this.state = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, 'utf8')) as StoreState)
      : {
          longPassword: generatePassword(),
          deviceId: generateDeviceId(),
          relayCredential: '',
          adminToken: randomBytes(16).toString('hex'),
        }
    this.state.relayCredential ??= ''
    this.state.adminToken ??= randomBytes(16).toString('hex')
    this.state.deviceId ??= generateDeviceId()
    this.state.longPassword ??= generatePassword()
    this.persist() // 初始状态（含生成的长期密码与设备编号）立即落盘
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

  /** UX-002：受控端设备编号（受控端 UI 展示；主控端凭此+密码连接） */
  get deviceId(): string {
    return this.state.deviceId
  }

  get relayCredential(): string {
    return this.state.relayCredential
  }

  get adminToken(): string {
    return this.state.adminToken
  }

  setRelayCredential(value: string): void {
    this.state.relayCredential = value
    this.persist()
  }

  /** REQ-002：重新生成长期密码 = 清凭据触发重新注册（旧密码哈希随注册更新即失效） */
  rotatePassword(): string {
    this.state.longPassword = generatePassword()
    this.state.relayCredential = ''
    this.persist()
    return this.state.longPassword
  }
}
