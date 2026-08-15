// SPEC: docs/deploy-server.md 被控端中继接入：安装码注册（设备编号+密码哈希）→ rathole 客户端 sidecar → 凭据心跳
// SPEC: docs/security-audit.md#SEC-001/002/003
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'

export interface RelayClientConfig {
  relayUrl: string
  relayInstallCode: string
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

export class RelayClient {
  private child: ChildProcess | null = null
  private timer: NodeJS.Timeout | undefined

  constructor(private cfg: RelayClientConfig, private log: (msg: string) => void) {}

  async start(): Promise<RelayBinding> {
    const base = this.cfg.relayUrl.replace(/\/$/, '')
    // SEC-001：安装码注册（凭据已保存则换用凭据鉴权直连隧道重连路径——当前版本注册接口幂等拒绝重复，故仅在无凭据时注册）
    let credential = this.cfg.savedCredential
    if (!credential) {
      const res = await fetch(`${base}/devices`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-install-code': this.cfg.relayInstallCode,
        },
        body: JSON.stringify({ deviceId: this.cfg.deviceId, passwordDigest: phcScrypt(this.cfg.longPassword) }),
      })
      if (!res.ok) throw new Error(`注册失败: ${res.status} ${await res.text()}`)
      const reg = (await res.json()) as RelayBinding
      credential = reg.credential
      this.cfg.onCredential(credential)
    }
    // 隧道：凭据换取最新隧道 token（/connect 服务端轮换语义由主控端使用；被控端用注册返回的初始 token 建隧道）
    const binding = await this.establishTunnel(base, credential)
    // 心跳 20s（SEC-001 凭据鉴权；在线窗口 45s）
    this.timer = setInterval(() => {
      fetch(`${base}/devices/${this.cfg.deviceId}/heartbeat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}` },
      }).catch(() => void 0)
    }, 20_000)
    this.timer.unref()
    return binding
  }

  private async establishTunnel(base: string, credential: string): Promise<RelayBinding> {
    const res = await fetch(`${base}/devices/${this.cfg.deviceId}/tunnel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}` },
    })
    if (!res.ok) throw new Error(`隧道签发失败: ${res.status} ${await res.text()}`)
    const binding = (await res.json()) as RelayBinding
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
