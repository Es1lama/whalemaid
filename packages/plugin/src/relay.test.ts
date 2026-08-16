// RelayClient 凭据策略单测（bug 根因回归）：只有中继明确拒绝凭据（401/403/404）才允许清空已保存凭据；
// 网络瞬断/5xx/限流必须保留凭据退避重试——否则清凭据后重注册必撞 409 device-already-registered，设备永久离线。
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RelayClient, RelayHttpError } from './relay.js'
import type { RelayBinding, RelayClientConfig } from './relay.js'

interface HttpsResponseLike {
  status: number
  json(): Promise<Record<string, unknown>>
  text(): Promise<string>
}

const okRes = (status: number, body: Record<string, unknown>): HttpsResponseLike => ({
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const binding: RelayBinding = {
  id: 'DEV-1',
  service: 'DEV-1',
  port: 5202,
  tunnelToken: 'token-1',
  credential: 'cred-new',
  serverPublicKey: 'pubkey',
}

function makeCfg(over: Partial<RelayClientConfig> = {}): RelayClientConfig {
  return {
    relayUrl: 'https://relay.test',
    relayInstallCode: 'code-1',
    relayFingerprint: 'fp',
    ratholeBin: process.execPath, // 测试里只会短暂执行后退出（避免 ENOENT 未处理事件）
    relayPort: 2333,
    pluginPort: 3181,
    dataDir: mkdtempSync(join(tmpdir(), 'whalemaid-relay-test-')),
    deviceId: 'DEV-1',
    longPassword: 'pw',
    savedCredential: '',
    onCredential: () => void 0,
    ...over,
  }
}

// 注入假请求：按 URL/头返回预设响应（无真实网络）
function fake(handler: (url: string, opts: { method: string; headers: Record<string, string>; body?: string }) => HttpsResponseLike | Promise<HttpsResponseLike>) {
  return async (url: string, opts: { method: string; headers: Record<string, string>; body?: string; fingerprint: string }): Promise<HttpsResponseLike> =>
    handler(url, opts)
}

describe('RelayClient 凭据策略', () => {
  it('隧道 500（服务端瞬断）不清凭据——否则重注册必撞 409 永久离线', async () => {
    let cleared = false
    const cfg = makeCfg({
      savedCredential: 'cred-old',
      onCredential: (c) => { if (c === '') cleared = true },
    })
    const client = new RelayClient(cfg, () => void 0, fake((url, opts) => {
      expect(url).toContain('/tunnel')
      expect(opts.headers.authorization).toBe('Bearer cred-old')
      return okRes(500, { error: 'boom' })
    }))
    await expect(client.start()).rejects.toBeInstanceOf(RelayHttpError)
    expect(cleared).toBe(false)
  })

  it('网络瞬断（ECONNREFUSED，非 HTTP 错误）同样保留凭据', async () => {
    let cleared = false
    const cfg = makeCfg({
      savedCredential: 'cred-old',
      onCredential: (c) => { if (c === '') cleared = true },
    })
    const client = new RelayClient(cfg, () => void 0, fake(() => { throw new Error('ECONNREFUSED') }))
    await expect(client.start()).rejects.toThrow('ECONNREFUSED')
    expect(cleared).toBe(false)
  })

  it('隧道 401 = 中继明确拒绝凭据：清凭据 → 带安装码重注册 → 新凭据重建隧道', async () => {
    const saved: string[] = []
    const cfg = makeCfg({ savedCredential: 'cred-old', onCredential: (c) => saved.push(c) })
    const client = new RelayClient(cfg, () => void 0, fake((url, opts) => {
      if (url.endsWith('/tunnel') && opts.headers.authorization === 'Bearer cred-old') {
        return okRes(401, { error: 'unauthorized' })
      }
      if (url.endsWith('/devices') && opts.method === 'POST') {
        expect(opts.headers['x-install-code']).toBe('code-1')
        return okRes(200, { ...binding })
      }
      if (url.endsWith('/tunnel') && opts.headers.authorization === 'Bearer cred-new') {
        return okRes(200, { ...binding })
      }
      throw new Error('unexpected ' + url)
    }))
    const got = await client.start()
    expect(got.service).toBe('DEV-1')
    expect(saved).toContain('')
    expect(saved).toContain('cred-new')
    client.stop()
  })

  it('注册 409 device-already-registered 给出可操作指引（吊销旧设备记录后可自愈）', async () => {
    const client = new RelayClient(makeCfg(), () => void 0, fake((url) => {
      if (url.endsWith('/devices')) return okRes(409, { error: 'device-already-registered' })
      throw new Error('unexpected')
    }))
    await expect(client.start()).rejects.toThrow(/吊销旧设备记录/)
  })

  it('注册 401 给出安装码重发指引', async () => {
    const client = new RelayClient(makeCfg(), () => void 0, fake((url) => {
      if (url.endsWith('/devices')) return okRes(401, { error: 'unauthorized' })
      throw new Error('unexpected')
    }))
    await expect(client.start()).rejects.toThrow(/安装码无效或已被消耗/)
  })
})
