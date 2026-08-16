// SPEC: docs/deploy-server.md 被控端中继接入：安装码注册（设备编号+密码哈希）→ rathole 客户端 sidecar → 凭据心跳
// SPEC: docs/security-audit.md#SEC-001/002/003
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, scryptSync, createHash } from 'node:crypto'
import https from 'node:https'

export interface RelayClientConfig {
  relayUrl: string
  relayInstallCode: string
  /** SEC-001：服务端证书 SHA-256 指纹（固定校验，防 MITM） */
  relayFingerprint: string
  ratholeBin: string
  /** 服务器 rathole 控制端口（默认 2333） */
  relayPort: number
  /** 本机插件监听端口（rathole 客户端 local_addr 目标） */
  pluginPort: number
  dataDir: string
  /** 受控端持久设备编号（UX-002） */
  deviceId: string
  /** 设备长期密码（生成 PHC scrypt 哈希上报，SEC-002） */
  longPassword: string
  /** 已保存的每设备凭据（续期/重连用） */
  savedCredential: string
  onCredential: (credential: string) => void
  onTemporaryStatus: (status: TemporaryPasswordStatus) => void
}

export type TemporaryPasswordState = 'none' | 'active' | 'consumed' | 'expired' | 'revoked'

export interface TemporaryPasswordStatus {
  state: TemporaryPasswordState
  expiresAt: number
  generation: number
}

export interface RelayBinding {
  id: string
  service: string
  port: number
  tunnelToken: string
  credential: string
  /** SEC-001/003：服务端 rathole noise 静态公钥（base64）——客户端必须 pin（NK 模式防中间人） */
  serverPublicKey: string
}

/** SEC-002：PHC scrypt 哈希（与服务端 scrypt crate 参数一致 ln=14,r=8,p=1） */
export function phcScrypt(password: string, salt: Buffer = randomBytes(16)): string {
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '')
  return `$scrypt$ln=14,r=8,p=1$${b64(salt)}$${b64(hash)}`
}

interface HttpsResponse {
  status: number
  json(): Promise<Record<string, unknown>>
  text(): Promise<string>
}

/** HTTP 状态错误：只有中继「明确拒绝凭据」的状态（401/403/404）才允许清空已保存凭据；
 *  网络瞬断/5xx/限流属于链路问题，清凭据会导致重注册撞 device-already-registered（409）而永久离线 */
export class RelayHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'RelayHttpError'
  }
}

/** 凭据失效状态集（中继明确表示不认识此凭据/设备） */
const CREDENTIAL_REJECTED = [401, 403, 404]

type RequestFn = (url: string, options: { method: string; headers: Record<string, string>; body?: string; fingerprint: string }) => Promise<HttpsResponse>

/** SEC-001：固定指纹的 HTTPS 请求。
 * 刻意 rejectUnauthorized:false——CA 链校验被"证书 SHA-256 指纹固定"替代（SSH TOFU 模型）；
 * 指纹不匹配立即断连，故不因跳过 CA 校验而降低安全性。 */
function pinnedRequest(url: string, options: { method: string; headers: Record<string, string>; body?: string; fingerprint: string }): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: options.method, headers: options.headers, rejectUnauthorized: false }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: res.statusCode ?? 0,
          json: async () => JSON.parse(text) as Record<string, unknown>,
          text: async () => text,
        })
      })
    })
    req.on('socket', (socket) => {
      socket.on('secureConnect', () => {
        const tlsSocket = socket as import('node:tls').TLSSocket
        const cert = tlsSocket.getPeerCertificate(true)
        const fp = createHash('sha256').update(cert.raw ?? Buffer.alloc(0)).digest('hex')
        if (options.fingerprint && fp !== options.fingerprint.replace(/[^0-9a-f]/gi, '')) {
          req.destroy(new Error(`证书指纹不匹配（预期 ${options.fingerprint.slice(0, 16)}… 实际 ${fp.slice(0, 16)}…），拒绝连接（SEC-001 防中间人）`))
        }
      })
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

export class RelayClient {
  private child: ChildProcess | null = null
  private timer: NodeJS.Timeout | undefined

  constructor(private cfg: RelayClientConfig, private log: (msg: string) => void, private req: RequestFn = pinnedRequest) {}

  private updateCredential(credential: string): void {
    this.cfg.savedCredential = credential
    this.cfg.onCredential(credential)
  }

  private requireCredential(): string {
    if (!this.cfg.savedCredential) throw new Error('设备尚无中继凭据，不能管理临时密码；请等待首次注册成功')
    return this.cfg.savedCredential
  }

  async issueTemporaryPassword(password: string, ttlSec: number): Promise<TemporaryPasswordStatus> {
    const credential = this.requireCredential()
    const base = this.cfg.relayUrl.replace(/\/$/, '')
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/temporary-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
      body: JSON.stringify({ passwordDigest: phcScrypt(password), ttlSec }),
      fingerprint: this.cfg.relayFingerprint,
    })
    if (res.status >= 300) throw new RelayHttpError(res.status, `临时密码签发失败: ${res.status} ${await res.text()}`)
    return (await res.json()) as unknown as TemporaryPasswordStatus
  }

  async revokeTemporaryPassword(): Promise<void> {
    const credential = this.requireCredential()
    const base = this.cfg.relayUrl.replace(/\/$/, '')
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/temporary-password`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${credential}` },
      fingerprint: this.cfg.relayFingerprint,
    })
    if (res.status >= 300) throw new RelayHttpError(res.status, `临时密码撤销失败: ${res.status} ${await res.text()}`)
  }

  /** 密码轮换（审计三轮#3）：凭据鉴权调 /password 端点原子替换 PHC——旧密码立即失效，凭据不丢、隧道不断；
   *  端点不可用（旧版中继）时退回：自吊销 + 重新注册（旧密码随之失效） */
  async rotatePassword(newPassword: string): Promise<void> {
    const base = this.cfg.relayUrl.replace(/\/$/, '')
    if (!this.cfg.savedCredential) {
      this.log('[whalemaid] 无中继凭据，跳过在线轮换（下次注册用新密码）')
      return
    }
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.savedCredential}` },
      body: JSON.stringify({ passwordDigest: phcScrypt(newPassword) }),
      fingerprint: this.cfg.relayFingerprint,
    })
    if (res.status < 300) {
      this.log('[whalemaid] 长期密码已轮换（服务端 PHC 原子替换，旧密码立即失效）')
      return
    }
    this.log(`[whalemaid] /password 端点不可用（${res.status}），退回自吊销+重注册`)
    await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${this.cfg.savedCredential}` },
      fingerprint: this.cfg.relayFingerprint,
    }).catch(() => void 0)
    this.updateCredential('')
  }

  async start(): Promise<RelayBinding> {
    const base = this.cfg.relayUrl.replace(/\/$/, '')
    let credential = this.cfg.savedCredential
    if (credential) {
      // 凭据复用：先试隧道；仅 401/403/404（中继明确拒绝凭据）才清空重注册——
      // 网络瞬断/5xx/限流必须保留凭据重试，否则清凭据后重注册必撞 409 device-already-registered，设备将永久离线
      try {
        const binding = await this.establishTunnel(base, credential)
        this.startHeartbeat(base, credential)
        return binding
      } catch (e) {
        if (e instanceof RelayHttpError && CREDENTIAL_REJECTED.includes(e.status)) {
          this.log(`[whalemaid] 凭据失效（${e.message}），重新注册`)
          this.updateCredential('')
          credential = ''
        } else {
          this.log(`[whalemaid] 隧道建立暂失败（${e instanceof Error ? e.message.slice(0, 80) : String(e)}），保留凭据退避重试`)
          throw e
        }
      }
    }
    const res = await this.req(`${base}/_whalemaid/devices`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-install-code': this.cfg.relayInstallCode,
      },
      body: JSON.stringify({ deviceId: this.cfg.deviceId, passwordDigest: phcScrypt(this.cfg.longPassword) }),
      fingerprint: this.cfg.relayFingerprint,
    })
    if (res.status >= 300) {
      const text = await res.text()
      if (res.status === 409 && text.includes('device-already-registered')) {
        throw new Error(`注册被拒 409 device-already-registered：该设备编号已在中继登记，但本机已保存凭据丢失——需服务端管理员吊销旧设备记录（DELETE /_whalemaid/devices/${this.cfg.deviceId} + Bearer 管理员令牌）后本插件会自动重试成功，无需重启宿主（docs/deploy-server.md）`)
      }
      if (res.status === 401) {
        throw new Error('注册失败 401：安装码无效或已被消耗（单次令牌）——需管理员重发安装码并更新宿主配置 relayInstallCode 后重启宿主（docs/deploy-server.md）')
      }
      throw new RelayHttpError(res.status, `注册失败: ${res.status} ${text}`)
    }
    const reg = (await res.json()) as unknown as RelayBinding
    credential = reg.credential
    this.updateCredential(credential)
    const binding = await this.establishTunnel(base, credential)
    this.startHeartbeat(base, credential)
    return binding
  }

  private startHeartbeat(base: string, credential: string): void {
    this.timer = setInterval(() => {
      this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/heartbeat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}` },
        fingerprint: this.cfg.relayFingerprint,
      })
        .then(async (res) => {
          // UX-009：主控端成功授权提示（受控端终端可见；计数由心跳带走清零）
          if (res.status === 200) {
            try {
              const body = (await res.json()) as { connectEvents?: number; temporaryPassword?: TemporaryPasswordStatus }
              if (body.connectEvents && body.connectEvents > 0) {
                this.log(`[whalemaid] 主控端已连接（最近 20s 内 ${body.connectEvents} 次授权）——有人正在远程控制本机`)
              }
              if (body.temporaryPassword) this.cfg.onTemporaryStatus(body.temporaryPassword)
            } catch { /* 心跳体解析失败不影响链路 */ }
          }
        })
        .catch(() => void 0)
    }, 20_000)
    this.timer.unref()
  }

  private async establishTunnel(base: string, credential: string): Promise<RelayBinding> {
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/tunnel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}` },
      fingerprint: this.cfg.relayFingerprint,
    })
    if (res.status >= 300) throw new RelayHttpError(res.status, `隧道签发失败: ${res.status} ${await res.text()}`)
    const binding = (await res.json()) as unknown as RelayBinding
    // SEC-003（同类全查：与 relayFingerprint 同等级别）——服务端未返回 noise 公钥 = 拒绝建隧道（无 pin = 防不了中间人）
    if (!binding.serverPublicKey) {
      throw new Error('服务端未返回 rathole noise 公钥（serverPublicKey），拒绝建立隧道（SEC-001/003）')
    }
    const host = new URL(base).hostname
    const cfgText = [
      '[client]',
      `remote_addr = "${host}:${this.cfg.relayPort}"`,
      '',
      '[client.transport]',
      'type = "noise"',
      '[client.transport.noise]',
      // NK 模式：固定服务端公钥（与中继持久化静态密钥对配套，防中间人；rathole 默认 transport 是 TCP 明文，必须显式 noise）
      `remote_public_key = "${binding.serverPublicKey}"`,
      '',
      `[client.services.${binding.service}]`,
      `token = "${binding.tunnelToken}"`,
      `local_addr = "127.0.0.1:${this.cfg.pluginPort}"`,
      '',
    ].join('\n')
    const dir = join(this.cfg.dataDir, 'relay')
    mkdirSync(dir, { recursive: true })
    const cfgFile = join(dir, 'rathole-client.toml')
    writeFileSync(cfgFile, cfgText, { mode: 0o600 })
    // UX-012/013 断线重连：客户端退出即指数退避重启（上限 30s），stop() 才终止
    let backoffMs = 1000
    const spawnClient = () => {
      this.child = spawn(this.cfg.ratholeBin, [cfgFile], { stdio: 'ignore' })
      this.child.on('exit', (code) => {
        this.log(`[whalemaid] rathole 客户端退出 code=${code}，${backoffMs}ms 后重连（UX-012）`)
        if (!this.stopped) {
          setTimeout(spawnClient, backoffMs).unref()
          backoffMs = Math.min(backoffMs * 2, 30_000)
        }
      })
      // 客户端稳定运行一段时间后重置退避
      setTimeout(() => { backoffMs = 1000 }, 60_000).unref()
    }
    spawnClient()
    return binding
  }

  private stopped = false

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.child?.kill()
    this.child = null
  }
}
