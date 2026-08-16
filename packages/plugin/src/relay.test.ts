// RelayClient 凭据策略单测（bug 根因回归）：只有中继明确拒绝凭据（401/403/404）才允许清空已保存凭据；
// 网络瞬断/5xx/限流必须保留凭据退避重试——否则清凭据后重注册必撞 409 device-already-registered，设备永久离线。
import { X509Certificate } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeFingerprint, RelayClient, RelayHttpError } from './relay.js'
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

const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBZDCCAQqgAwIBAgIUeOmQGeU0WKUb54T0bWk7NRykx4UwCgYIKoZIzj0EAwIw
ITEfMB0GA1UEAwwWcmNnZW4gc2VsZiBzaWduZWQgY2VydDAgFw03NTAxMDEwMDAw
MDBaGA80MDk2MDEwMTAwMDAwMFowITEfMB0GA1UEAwwWcmNnZW4gc2VsZiBzaWdu
ZWQgY2VydDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABOy/6X+HLqtxslsCi/rm
TZs0/9m71xg5ZARATZEqOBcPagIWRfV/uZ61ilreqzDySLZI31UkBKotJyV/Qu4C
BxujHjAcMBoGA1UdEQQTMBGCD3doYWxlbWFpZC1yZWxheTAKBggqhkjOPQQDAgNI
ADBFAiEAutrveOEoy/ggSeThQBRkQEgbdwChhFRQAa52lLz81iwCIENmtSVAhUHW
3f3CkuFhYmsIlXDZOSyVCcdc1BYsp6ju
-----END CERTIFICATE-----`

const TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgsNHmUEuR4AWJyvNj
4Gufq6awNe9UF/1BMbM0ieg+ciChRANCAATsv+l/hy6rcbJbAov65k2bNP/Zu9cY
OWQEQE2RKjgXD2oCFkX1f7metYpa3qsw8ki2SN9VJASqLSclf0LuAgcb
-----END PRIVATE KEY-----`

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
    onTemporaryStatus: () => void 0,
    ...over,
  }
}

// 注入假请求：按 URL/头返回预设响应（无真实网络）
function fake(handler: (url: string, opts: { method: string; headers: Record<string, string>; body?: string }) => HttpsResponseLike | Promise<HttpsResponseLike>) {
  return async (url: string, opts: { method: string; headers: Record<string, string>; body?: string; fingerprint: string }): Promise<HttpsResponseLike> =>
    handler(url, opts)
}

describe('relay certificate fingerprint normalization', () => {
  it('accepts the uppercase colon-delimited OpenSSL form used in deployment docs', () => {
    expect(normalizeFingerprint('08:4B:25:C5:8F')).toBe('084b25c58f')
    expect(normalizeFingerprint('084b25c58f')).toBe('084b25c58f')
  })

  it('pins every fresh TLS connection without reusing an empty resumed certificate', async () => {
    const server = createServer({ cert: TLS_CERT, key: TLS_KEY }, (_req, res) => {
      res.setHeader('connection', 'close')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ state: 'active', expiresAt: 3000, generation: 2 }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    const relayUrl = `https://127.0.0.1:${address.port}`
    const fingerprint = new X509Certificate(TLS_CERT).fingerprint256
    try {
      const client = new RelayClient(makeCfg({ relayUrl, relayFingerprint: fingerprint, savedCredential: 'cred-live' }), () => void 0)
      await expect(client.issueTemporaryPassword('WMT-FIRST-PASS', 600)).resolves.toMatchObject({ state: 'active' })
      await expect(client.issueTemporaryPassword('WMT-SECOND-PASS', 600)).resolves.toMatchObject({ state: 'active' })

      const rejected = new RelayClient(makeCfg({ relayUrl, relayFingerprint: '00'.repeat(32), savedCredential: 'cred-live' }), () => void 0)
      await expect(rejected.issueTemporaryPassword('WMT-WRONG-PIN', 600)).rejects.toThrow(/证书指纹不匹配/)
    } finally {
      await new Promise<void>(resolve => { server.close(() => resolve()) })
    }
  })
})

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
        expect(JSON.parse(opts.body ?? '{}').hostAuthority).toBe('127.0.0.1:3181')
        return okRes(200, { ...binding })
      }
      if (url.endsWith('/tunnel') && opts.headers.authorization === 'Bearer cred-new') {
        expect(JSON.parse(opts.body ?? '{}').hostAuthority).toBe('127.0.0.1:3181')
        return okRes(200, { ...binding })
      }
      if (url.endsWith('/temporary-password') && opts.method === 'POST') {
        expect(opts.headers.authorization).toBe('Bearer cred-new')
        expect(opts.body).not.toContain('WMT-ABCD-EFGH')
        expect(JSON.parse(opts.body ?? '{}').passwordDigest).toMatch(/^\$scrypt\$/)
        return okRes(200, { state: 'active', expiresAt: 2000, generation: 1 })
      }
      throw new Error('unexpected ' + url)
    }))
    const got = await client.start()
    expect(got.service).toBe('DEV-1')
    expect(saved).toContain('')
    expect(saved).toContain('cred-new')
    await expect(client.issueTemporaryPassword('WMT-ABCD-EFGH', 600)).resolves.toEqual({
      state: 'active',
      expiresAt: 2000,
      generation: 1,
    })
    client.stop()
  })

  it('临时密码签发与撤销必须使用设备凭据，且未注册时失败关闭', async () => {
    const methods: string[] = []
    const client = new RelayClient(makeCfg({ savedCredential: 'cred-live' }), () => void 0, fake((url, opts) => {
      if (!url.endsWith('/temporary-password')) throw new Error('unexpected ' + url)
      expect(opts.headers.authorization).toBe('Bearer cred-live')
      methods.push(opts.method)
      return opts.method === 'POST'
        ? okRes(200, { state: 'active', expiresAt: 3000, generation: 2 })
        : okRes(200, { state: 'revoked' })
    }))
    await client.issueTemporaryPassword('WMT-ABCD-EFGH', 900)
    await client.revokeTemporaryPassword()
    expect(methods).toEqual(['POST', 'DELETE'])

    const unregistered = new RelayClient(makeCfg(), () => void 0, fake(() => {
      throw new Error('request should not run')
    }))
    await expect(unregistered.issueTemporaryPassword('WMT-ABCD-EFGH', 900)).rejects.toThrow(/中继凭据/)
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
