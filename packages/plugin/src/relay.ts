// SPEC: docs/deploy-server.md 被控端中继接入：注册/心跳/rathole 客户端 sidecar（ADR-032）
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RelayClientConfig {
  relayUrl: string
  relayToken: string
  ratholeBin: string
  /** 服务器 rathole 控制端口（默认 2333） */
  relayPort: number
  /** 本机插件监听端口（rathole 客户端 local_addr 目标） */
  pluginPort: number
  dataDir: string
}

export interface RelayBinding {
  id: string
  service: string
  port: number
  token: string
}

export class RelayClient {
  private child: ChildProcess | null = null
  private timer: NodeJS.Timeout | undefined

  constructor(private cfg: RelayClientConfig, private log: (msg: string) => void) {}

  async start(): Promise<RelayBinding> {
    const base = this.cfg.relayUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/devices`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.relayToken}`, 'content-type': 'application/json' },
    })
    if (!res.ok) throw new Error(`中继注册失败: ${res.status} ${await res.text()}`)
    const binding = (await res.json()) as RelayBinding
    const host = new URL(base).hostname
    const cfgText = [
      '[client]',
      `remote_addr = "${host}:${this.cfg.relayPort}"`,
      '',
      `[client.services.${binding.service}]`,
      `token = "${binding.token}"`,
      `local_addr = "127.0.0.1:${this.cfg.pluginPort}"`,
      '',
    ].join('\n')
    const dir = join(this.cfg.dataDir, 'relay')
    mkdirSync(dir, { recursive: true })
    const cfgFile = join(dir, 'rathole-client.toml')
    writeFileSync(cfgFile, cfgText, { mode: 0o600 })
    this.child = spawn(this.cfg.ratholeBin, [cfgFile], { stdio: 'ignore' })
    this.child.on('exit', (code) => this.log(`[whalemaid] rathole 客户端退出 code=${code}`))
    // 心跳 20s（TM-005 在线状态窗口 45s）
    this.timer = setInterval(() => {
      fetch(`${base}/devices/${binding.id}/heartbeat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.relayToken}` },
      }).catch(() => void 0)
    }, 20_000)
    this.timer.unref()
    return binding
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.child?.kill()
    this.child = null
  }
}
