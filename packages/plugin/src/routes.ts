// SPEC: docs/protocol.md#PROTO-001/003/004/007 路由与认证网关
// SPEC: docs/threat-model.md#TM-001..013（网关即检查点）
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  CAPABILITIES,
  DEVICE_ID_PATTERN,
  ERROR_CODES,
  PROTOCOL_VERSION,
  type RpcRequest,
  type RpcResponse,
} from '@whalemaid/contract'
import type { Store } from './store.js'
import type { PasswordVerifier } from './verifier.js'
import type { EventHub } from './events.js'

/** 移动端构建产物（/m 直连 UI，REQ-001）；打包时由 build 脚本拷入 */
const MOBILE_DIST = fileURLToPath(new URL('./mobile-dist/', import.meta.url))

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
}

/** 静态文件服务（仅服务打包产物目录内文件，防路径穿越） */
function serveStatic(res: ServerResponse, rel: string): boolean {
  const ext = rel.slice(rel.lastIndexOf('.'))
  const type = CONTENT_TYPES[ext] ?? 'application/octet-stream'
  const abs = join(MOBILE_DIST, rel)
  if (!abs.startsWith(MOBILE_DIST)) return false
  try {
    const data = readFileSync(abs)
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
    res.end(data)
    return true
  } catch {
    return false
  }
}

/** dsh-host-apiproxy 宿主侧纪律：{ rpcId, result: { ok, value | error } }（API 契约权威） */
export interface HostResult<T = unknown> {
  rpcId: string
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
}

export interface HostApiProxy {
  sessions: {
    list(r: { rpcId: string; payload: { cursor?: string } }): Promise<HostResult<{ items: unknown[] }>>
    history(r: { rpcId: string; payload: { sessionId: string; beforeSeq?: number; maxMessages?: number } }): Promise<HostResult<unknown>>
    create(r: { rpcId: string; payload: { workspaceId?: string; cwd?: string; sessionId?: string } }): Promise<HostResult<{ sessionId: string }>>
    stop(r: { rpcId: string; payload: { sessionId: string } }): Promise<HostResult<unknown>>
    models(r: { rpcId: string; payload: { sessionId: string } }): Promise<HostResult<unknown>>
    selectModel(r: { rpcId: string; payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string } }): Promise<HostResult<unknown>>
    prompt(r: { rpcId: string; payload: { sessionId: string; mode: 'queue' | 'steer'; content: unknown[] } }): Promise<HostResult<unknown>>
  }
  workspace: {
    list(r: { rpcId: string; payload: Record<string, never> }): Promise<HostResult<{ items: unknown[] }>>
    create(r: { rpcId: string; payload: { path: string } }): Promise<HostResult<{ workspaceId: string; created: boolean }>>
  }
  host: {
    listDirectory(r: { rpcId: string; payload: { path?: string } }, signal: AbortSignal): Promise<HostResult<unknown>>
    createDirectory(r: { rpcId: string; payload: { path: string; name: string } }): Promise<HostResult<unknown>>
  }
}

/** 无需 Bearer 的公开方法（PROTO-003） */
const PUBLIC_METHODS = new Set(['device.handshake', 'device.bind', 'device.bindTemporary'])

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function ok(res: ServerResponse, rpcId: string, data: unknown): void {
  json(res, 200, { v: PROTOCOL_VERSION, rpcId, ok: true, data } satisfies RpcResponse)
}

function fail(res: ServerResponse, rpcId: string, code: string, message: string): void {
  json(res, 200, { v: PROTOCOL_VERSION, rpcId, ok: false, error: { code, message } } satisfies RpcResponse)
}

function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export interface RouterDeps {
  store: Store
  verifier: PasswordVerifier
  apiProxy: HostApiProxy
  hub: EventHub
}

/** 挑战-应答验签（TM-004）：ECDSA P-256，WebCrypto IEEE P1363 裸签名 */
function verifyNonceSignature(jwk: JsonWebKey, nonce: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: jwk as never, format: 'jwk' })
    return cryptoVerify(
      'sha256',
      Buffer.from(nonce, 'utf8'),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signatureB64, 'base64'),
    )
  } catch {
    return false
  }
}

/** 宿主方法透传：业务错误码原样透出 */
async function passThrough(res: ServerResponse, rpcId: string, run: () => Promise<HostResult>): Promise<void> {
  try {
    const r = await run()
    if (r.result.ok) return ok(res, rpcId, r.result.value)
    return fail(res, rpcId, r.result.error.code, r.result.error.message)
  } catch (err) {
    return fail(res, rpcId, ERROR_CODES.serverError, err instanceof Error ? err.message.slice(0, 200) : 'internal error')
  }
}

export function makeRouter(deps: RouterDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const { store, verifier, apiProxy, hub } = deps

  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    if (path === '/healthz') return json(res, 200, { ok: true })
    if (path === '/api/v1/events') return hub.subscribe(req, res)
    if (path === '/api/v1/poll') return json(res, 200, { events: hub.replay(Number(url.searchParams.get('since') ?? 0)) })
    // 直连移动 UI（REQ-001）：/m 与 /m/ 同源，静态资源从 mobile-dist 服务
    if (path === '/m' || path === '/m/') return serveStatic(res, 'index.html') || json(res, 404, { error: 'mobile dist not built' })
    if (path.startsWith('/assets/') || path === '/manifest.webmanifest') {
      return serveStatic(res, path.slice(1)) || json(res, 404, { error: 'not found' })
    }
    if (path !== '/api/v1') return json(res, 404, { error: 'not-found' })

    const method = url.searchParams.get('method') ?? ''
    let envelope: RpcRequest = { v: PROTOCOL_VERSION, rpcId: '', method, payload: {} }
    if (req.method === 'POST') {
      try {
        envelope = JSON.parse(await readBody(req)) as RpcRequest
      } catch {
        return fail(res, '', ERROR_CODES.badRequest, 'invalid body')
      }
    }

    const rpcId = envelope.rpcId ?? ''
    const payload = envelope.payload ?? {}
    if (envelope.v !== PROTOCOL_VERSION) {
      return fail(res, rpcId, ERROR_CODES.badRequest, `unsupported version ${envelope.v}`)
    }

    // 认证闸门（TM-005：吊销设备即拒绝）
    let deviceId = ''
    if (!PUBLIC_METHODS.has(method)) {
      deviceId = (await verifier.verify({ header: req.headers.authorization, method })) ?? ''
      if (!deviceId) {
        store.audit('unknown', method, false)
        return fail(res, rpcId, ERROR_CODES.authFailed, 'invalid or revoked device token')
      }
    }

    store.audit(deviceId || 'anonymous', method, true)
    try {
      switch (method) {
        case 'device.handshake': {
          const p = payload as { deviceId?: string; publicKeyJwk?: JsonWebKey }
          if (!p.deviceId || !DEVICE_ID_PATTERN.test(p.deviceId) || !p.publicKeyJwk) {
            return fail(res, rpcId, ERROR_CODES.badRequest, 'invalid deviceId or key')
          }
          const nonce = store.addNonce(p.deviceId, p.publicKeyJwk)
          return ok(res, rpcId, {
            nonce,
            caps: [CAPABILITIES.session, CAPABILITIES.workspaceCreate, CAPABILITIES.directoryBrowse, CAPABILITIES.direct],
          })
        }
        case 'device.bind': {
          const p = payload as { deviceId?: string; password?: string; nonce?: string; nonceSignature?: string }
          if (!p.deviceId || !p.password || !p.nonce || !p.nonceSignature) {
            return fail(res, rpcId, ERROR_CODES.badRequest, 'missing fields')
          }
          const taken = store.takeNonce(p.nonce)
          if (!taken || taken.deviceId !== p.deviceId) {
            return fail(res, rpcId, ERROR_CODES.authFailed, 'nonce missing, expired or mismatched')
          }
          if (!verifyNonceSignature(taken.publicKeyJwk, p.nonce, p.nonceSignature)) {
            return fail(res, rpcId, ERROR_CODES.authFailed, 'bad signature')
          }
          if (!verifier.checkPassword(p.password)) {
            return fail(res, rpcId, ERROR_CODES.authFailed, 'bad password')
          }
          const token = store.issueToken(p.deviceId)
          store.bindPublicKey(p.deviceId, taken.publicKeyJwk)
          return ok(res, rpcId, { deviceToken: token })
        }
        case 'device.bindTemporary': {
          const p = payload as { deviceId?: string; password?: string }
          if (!p.deviceId || !p.password) return fail(res, rpcId, ERROR_CODES.badRequest, 'missing fields')
          if (!verifier.checkTemporaryPassword(p.password)) {
            return fail(res, rpcId, ERROR_CODES.authFailed, 'bad or expired temporary password')
          }
          const token = store.issueTemporaryToken(p.deviceId)
          return ok(res, rpcId, { deviceToken: token, expiresAt: Date.now() + 12 * 3600_000 })
        }
        case 'session.list':
          return passThrough(res, rpcId, () => apiProxy.sessions.list({ rpcId, payload: payload as { cursor?: string } }))
        case 'session.history':
          return passThrough(res, rpcId, () =>
            apiProxy.sessions.history({ rpcId, payload: payload as { sessionId: string; beforeSeq?: number; maxMessages?: number } }),
          )
        case 'session.create':
          return passThrough(res, rpcId, () =>
            apiProxy.sessions.create({ rpcId, payload: payload as { workspaceId?: string; cwd?: string; sessionId?: string } }),
          )
        case 'session.prompt': {
          const p = payload as { sessionId?: string; text?: string; visionNote?: string }
          if (!p.sessionId || typeof p.text !== 'string') {
            return fail(res, rpcId, ERROR_CODES.badRequest, 'sessionId/text required')
          }
          const text = p.visionNote ? `${p.text}\n\n[图片描述] ${p.visionNote}` : p.text
          return passThrough(res, rpcId, () =>
            apiProxy.sessions.prompt({ rpcId, payload: { sessionId: p.sessionId as string, mode: 'queue', content: [{ type: 'text', text }] } }),
          )
        }
        case 'session.stop':
          return passThrough(res, rpcId, () => apiProxy.sessions.stop({ rpcId, payload: payload as { sessionId: string } }))
        case 'session.models':
          return passThrough(res, rpcId, () => apiProxy.sessions.models({ rpcId, payload: payload as { sessionId: string } }))
        case 'session.selectModel':
          return passThrough(res, rpcId, () =>
            apiProxy.sessions.selectModel({ rpcId, payload: payload as { sessionId: string; provider: string; model: string; reasoningEffort?: string } }),
          )
        case 'permission.get': {
          const p = payload as { sessionId?: string }
          if (!p.sessionId) return fail(res, rpcId, ERROR_CODES.badRequest, 'sessionId required')
          // 权限预设读取：历史尾部 projection 基线（与参考实现同源）
          const r = await apiProxy.sessions.history({ rpcId, payload: { sessionId: p.sessionId, maxMessages: 1 } })
          if (!r.result.ok) return fail(res, rpcId, r.result.error.code, r.result.error.message)
          const projections = (r.result.value as { projections?: Record<string, unknown> })?.projections
          return ok(res, rpcId, { permissions: projections?.['permissions'] ?? null })
        }
        case 'permission.set': {
          const p = payload as { sessionId?: string; value?: string }
          if (!p.sessionId || typeof p.value !== 'string') return fail(res, rpcId, ERROR_CODES.badRequest, 'sessionId/value required')
          // 权限预设切换 = /permission 斜杠命令（与参考实现同源，mode-agnostic）
          return passThrough(res, rpcId, () =>
            apiProxy.sessions.prompt({ rpcId, payload: { sessionId: p.sessionId as string, mode: 'queue', content: [{ type: 'text', text: `/permission ${p.value}` }] } }),
          )
        }
        case 'workspace.list':
          return passThrough(res, rpcId, () => apiProxy.workspace.list({ rpcId, payload: {} }))
        case 'workspace.create':
          return passThrough(res, rpcId, () =>
            apiProxy.workspace.create({ rpcId, payload: payload as { path: string } }),
          )
        case 'host.listDirectory': {
          const p = payload as { path?: string; scope?: string }
          if (p?.scope === 'full') {
            // TODO(ADR-008): 全盘浏览需长期密码二次确认，宿主策略实现
            return fail(res, rpcId, ERROR_CODES.scopeDenied, 'full scope requires confirmation')
          }
          return passThrough(res, rpcId, () =>
            apiProxy.host.listDirectory({ rpcId, payload: { path: p?.path } }, new AbortController().signal),
          )
        }
        case 'host.createDirectory':
          return passThrough(res, rpcId, () =>
            apiProxy.host.createDirectory({ rpcId, payload: payload as { path: string; name: string } }),
          )
        case 'voice.transcribe':
        case 'voice.hotwords.update':
        case 'vision.describe':
          // TODO(REQ-020/021/022): V1 实现（BYOK 宿主代理调用）
          return fail(res, rpcId, ERROR_CODES.capUnsupported, 'not implemented yet')
        default:
          return fail(res, rpcId, ERROR_CODES.methodUnknown, `unknown method: ${method}`)
      }
    } catch (err) {
      store.audit(deviceId || 'unknown', method, false)
      return fail(res, rpcId, ERROR_CODES.serverError, err instanceof Error ? err.message.slice(0, 200) : 'internal error')
    }
  }
}

export function createWhalemaidServer(deps: RouterDeps & { host: string; port: number }) {
  return createServer(makeRouter(deps)).listen(deps.port, deps.host)
}
