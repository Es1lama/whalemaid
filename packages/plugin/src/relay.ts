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
}

export interface RelayBinding {
  id: string
  service: string
  port: number
  tunnelToken: string
  credential: string
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

  constructor(private cfg: RelayClientConfig, private log: (msg: string) => void) {}

  async start(): Promise<RelayBinding> {
    const base = this.cfg.relayUrl.replace(/\/$/, '')
    let credential = this.cfg.savedCredential
    if (credential) {
      // 凭据复用：先试隧道；401/403 = 该中继不认识此凭据（换中继/清档）→ 清空重注册
      try {
        const binding = await this.establishTunnel(base, credential)
        this.startHeartbeat(base, credential)
        return binding
      } catch (e) {
        this.log(`[whalemaid] 凭据失效（${e instanceof Error ? e.message.slice(0, 60) : String(e)}），重新注册`)
        this.cfg.onCredential('')
        credential = ''
      }
    }
    const res = await pinnedRequest(`${base}/_whalemaid/devices`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-install-code': this.cfg.relayInstallCode,
      },
      body: JSON.stringify({ deviceId: this.cfg.deviceId, passwordDigest: phcScrypt(this.cfg.longPassword) }),
      fingerprint: this.cfg.relayFingerprint,
    })
    if (res.status >= 300) throw new Error(`注册失败: ${res.status} ${await res.text()}`)
    const reg = (await res.json()) as unknown as RelayBinding
    credential = reg.credential
    this.cfg.onCredential(credential)
    const binding = await this.establishTunnel(base, credential)
    this.startHeartbeat(base, credential)
    return binding
  }

  private startHeartbeat(base: string, credential: string): void {
    this.timer = setInterval(() => {
      pinnedRequest(`${base}/_whalemaid/devices/${this.cfg.deviceId}/heartbeat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}` },
        fingerprint: this.cfg.relayFingerprint,
      }).catch(() => void 0)
    }, 20_000)
    this.timer.unref()
  }

  private async establishTunnel(base: string, credential: string): Promise<RelayBinding> {
    const res = await pinnedRequest(`${base}/_whalemaid/devices/${this.cfg.deviceId}/tunnel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}` },
      fingerprint: this.cfg.relayFingerprint,
    })
    if (res.status >= 300) throw new Error(`隧道签发失败: ${res.status} ${await res.text()}`)
    const binding = (await res.json()) as unknown as RelayBinding
    const host = new URL(base).hostname
    const cfgText = [
      '[client]',
      `remote_addr = "${host}:${this.cfg.relayPort}"`,
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
    this.child = spawn(this.cfg.ratholeBin, [cfgFile], { stdio: 'ignore' })
    this.child.on('exit', (code) => this.log(`[whalemaid] rathole 客户端退出 code=${code}`))
    return binding
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.child?.kill()
    this.child = null
  }
}
