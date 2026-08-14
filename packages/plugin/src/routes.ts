// SPEC: docs/protocol.md#PROTO-001/003/004/007 路由与认证网关
// SPEC: docs/threat-model.md#TM-001..013（网关即检查点）
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
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

/** 宿主 API 最小接口（骨架）：类型细化见 M1 测试 loop 的 TODO */
export interface HostApiProxy {
  workspace: {
    list(payload?: unknown): Promise<unknown>
    create(payload: unknown): Promise<unknown>
  }
  session: {
    list(payload?: unknown): Promise<unknown>
    history(payload: unknown): Promise<unknown>
    create(payload: unknown): Promise<unknown>
    prompt(payload: unknown): Promise<unknown>
    stop(payload: unknown): Promise<unknown>
    models(payload: unknown): Promise<unknown>
    selectModel(payload: unknown): Promise<unknown>
  }
  host: {
    listDirectory(payload: unknown): Promise<unknown>
    createDirectory(payload: unknown): Promise<unknown>
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

/** 挑战-应答验签（TM-004）：ECDSA P-256，绑定公钥后 nonce 签名必须匹配 */
function verifyNonceSignature(jwk: JsonWebKey, nonce: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: jwk as never, format: 'jwk' })
    return cryptoVerify(null, Buffer.from(nonce, 'utf8'), key, Buffer.from(signatureB64, 'base64'))
  } catch {
    return false
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
    if (path === '/m') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end('<!doctype html><meta charset="utf-8"><title>WhaleMaid</title><h1>WhaleMaid 移动端构建中</h1>')
    }
    if (path !== '/api/v1') return json(res, 404, { error: 'not-found' })

    const method = url.searchParams.get('method') ?? ''
    let payload: unknown = {}
    if (req.method === 'POST') {
      try {
        payload = JSON.parse(await readBody(req))
      } catch {
        return fail(res, '', ERROR_CODES.badRequest, 'invalid body')
      }
    }

    const rpcId = (payload as RpcRequest | undefined)?.rpcId ?? ''

    // 认证闸门（TM-005：吊销设备即拒绝）
    if (!PUBLIC_METHODS.has(method)) {
      const deviceId = await verifier.verify({ header: req.headers.authorization, method })
      if (!deviceId) {
        store.audit('unknown', method, false)
        return fail(res, rpcId, ERROR_CODES.authFailed, 'invalid or revoked device token')
      }
    }

    store.audit('n/a', method, true)
    try {
      switch (method) {
        case 'device.handshake': {
          const p = payload as { deviceId?: string; publicKeyJwk?: JsonWebKey }
          if (!p.deviceId || !DEVICE_ID_PATTERN.test(p.deviceId) || !p.publicKeyJwk) {
            return fail(res, rpcId, ERROR_CODES.badRequest, 'invalid deviceId or key')
          }
          const nonce = store.addNonce(p.deviceId)
          return ok(res, rpcId, { nonce, caps: [CAPABILITIES.session, CAPABILITIES.workspaceCreate, CAPABILITIES.directoryBrowse, CAPABILITIES.direct] })
        }
        case 'device.bind': {
          const p = payload as { deviceId?: string; password?: string; nonce?: string; nonceSignature?: string; publicKeyJwk?: JsonWebKey }
          if (!p.deviceId || !p.password || !p.nonce || !p.nonceSignature || !p.publicKeyJwk) {
            return fail(res, rpcId, ERROR_CODES.badRequest, 'missing fields')
          }
          const taken = store.takeNonce(p.nonce)
          if (!taken || taken.deviceId !== p.deviceId) {
            return fail(res, rpcId, ERROR_CODES.authFailed, 'nonce missing, expired or mismatched')
          }
          if (!verifyNonceSignature(p.publicKeyJwk, p.nonce, p.nonceSignature)) {
            return fail(res, rpcId, ERROR_CODES.authFailed, 'bad signature')
          }
          if (!verifier.checkPassword(p.password)) {
            return fail(res, rpcId, ERROR_CODES.authFailed, 'bad password')
          }
          const token = store.issueToken(p.deviceId)
          store.bindPublicKey(p.deviceId, p.publicKeyJwk)
          return ok(res, rpcId, { deviceToken: token })
        }
        case 'device.bindTemporary':
          // TODO(REQ-003): 临时密码实现（一次性/限时），M1 测试 loop 补齐
          return fail(res, rpcId, ERROR_CODES.capUnsupported, 'temporary password not implemented yet')
        case 'session.list':
          return ok(res, rpcId, await apiProxy.session.list(payload))
        case 'session.history':
          return ok(res, rpcId, await apiProxy.session.history(payload))
        case 'session.create':
          return ok(res, rpcId, await apiProxy.session.create(payload))
        case 'session.prompt':
          return ok(res, rpcId, await apiProxy.session.prompt(payload))
        case 'session.stop':
          return ok(res, rpcId, await apiProxy.session.stop(payload))
        case 'session.models':
          return ok(res, rpcId, await apiProxy.session.models(payload))
        case 'session.selectModel':
          return ok(res, rpcId, await apiProxy.session.selectModel(payload))
        case 'permission.get':
        case 'permission.set':
          // TODO(REQ-008): permissions projection 透传，M1 测试 loop 对齐 dsh-host-apiproxy
          return fail(res, rpcId, ERROR_CODES.capUnsupported, 'permission passthrough pending')
        case 'workspace.create':
          return ok(res, rpcId, await apiProxy.workspace.create(payload))
        case 'host.listDirectory': {
          const p = payload as { scope?: string }
          if (p?.scope === 'full') {
            // TODO(ADR-008): 全盘浏览需长期密码二次确认，宿主策略实现
            return fail(res, rpcId, ERROR_CODES.scopeDenied, 'full scope requires confirmation')
          }
          return ok(res, rpcId, await apiProxy.host.listDirectory(payload))
        }
        case 'host.createDirectory':
          return ok(res, rpcId, await apiProxy.host.createDirectory(payload))
        case 'voice.transcribe':
        case 'voice.hotwords.update':
        case 'vision.describe':
          // TODO(REQ-020/021/022): V1 实现（BYOK 宿主代理调用）
          return fail(res, rpcId, ERROR_CODES.capUnsupported, 'not implemented yet')
        default:
          return fail(res, rpcId, ERROR_CODES.methodUnknown, `unknown method: ${method}`)
      }
    } catch (err) {
      store.audit('n/a', method, false)
      return fail(res, rpcId, ERROR_CODES.serverError, err instanceof Error ? err.message.slice(0, 200) : 'internal error')
    }
  }
}

export function createWhalemaidServer(deps: RouterDeps & { host: string; port: number }) {
  return createServer(makeRouter(deps)).listen(deps.port, deps.host)
}
