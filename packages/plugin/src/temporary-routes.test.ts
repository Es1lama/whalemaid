import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { registerTemporaryPasswordRoutes } from './temporary-routes.js'
import type { TemporaryPasswordManager } from './temporary.js'

interface CapturedRoute {
  path: string
  handler: (req: { method?: string; headers: Record<string, string | string[]>; on: EventEmitter['on'] }, res: TestResponse) => void
}

interface TestResponse {
  writeHead(code: number, headers?: Record<string, string>): void
  end(body: string): void
}

function harness() {
  const routes = new Map<string, CapturedRoute>()
  const disposals: string[] = []
  const server = {
    register: (route: CapturedRoute) => {
      routes.set(route.path, route)
      return () => { disposals.push(route.path); routes.delete(route.path) }
    },
  }
  const snapshot = vi.fn().mockReturnValue({ password: 'WMT-ABCD-EFGH', state: 'active', expiresAt: 2_000, generation: 1 })
  const issue = vi.fn().mockResolvedValue({ password: 'WMT-NEW1-PASS', state: 'active', expiresAt: 3_000, generation: 2 })
  const revoke = vi.fn().mockResolvedValue(undefined)
  const manager = { snapshot, issue, revoke } as unknown as TemporaryPasswordManager
  const dispose = registerTemporaryPasswordRoutes(server, manager, 'WHALE-TEST-0001')

  const call = (path: string, method: string, body = '', headers: Record<string, string | string[]> = {}) => new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
    const req = new EventEmitter() as EventEmitter & { method: string; headers: Record<string, string | string[]> }
    req.method = method
    req.headers = headers
    let status = 0
    const res: TestResponse = {
      writeHead: code => { status = code },
      end: value => { resolve({ status, body: JSON.parse(value) as Record<string, unknown> }) },
    }
    routes.get(path)?.handler(req, res)
    queueMicrotask(() => {
      if (body) req.emit('data', Buffer.from(body))
      req.emit('end')
    })
  })

  return { call, dispose, disposals, snapshot, issue, revoke }
}

const clientHeaders = { 'x-whalemaid-client': '1' }
const controllerHeaders = { ...clientHeaders, 'x-whalemaid-transport-role': 'controller' }

describe('temporary password host routes', () => {
  it('拒绝没有同源客户端 header 的请求', async () => {
    const h = harness()
    expect((await h.call('/api/whalemaid/device', 'GET')).status).toBe(403)
    expect((await h.call('/api/whalemaid/temporary-password', 'POST', '{"ttlSec":600}', { 'content-type': 'application/json' })).status).toBe(403)
  })

  it('拒绝中继标记的控制端流量且不读取或修改凭据状态', async () => {
    const h = harness()

    expect((await h.call('/api/whalemaid/device', 'GET', '', controllerHeaders)).status).toBe(403)
    expect((await h.call('/api/whalemaid/temporary-password', 'POST', '{"ttlSec":600}', {
      ...controllerHeaders,
      'content-type': 'application/json',
    })).status).toBe(403)
    expect((await h.call('/api/whalemaid/temporary-password', 'DELETE', '', {
      ...controllerHeaders,
      'x-whalemaid-transport-role': ['host', 'controller'],
    })).status).toBe(403)
    expect(h.snapshot).not.toHaveBeenCalled()
    expect(h.issue).not.toHaveBeenCalled()
    expect(h.revoke).not.toHaveBeenCalled()
  })

  it('设备状态不暴露长期密码或本地管理 token', async () => {
    const h = harness()
    const response = await h.call('/api/whalemaid/device', 'GET', '', clientHeaders)
    expect(response.status).toBe(200)
    expect(response.body.deviceId).toBe('WHALE-TEST-0001')
    expect(JSON.stringify(response.body)).not.toMatch(/longPassword|adminToken/)
  })

  it('只接受 JSON 签发请求并透传 TTL', async () => {
    const h = harness()
    const bad = await h.call('/api/whalemaid/temporary-password', 'POST', '{"ttlSec":600}', clientHeaders)
    expect(bad.status).toBe(400)

    const good = await h.call('/api/whalemaid/temporary-password', 'POST', '{"ttlSec":900}', {
      ...clientHeaders,
      'content-type': 'application/json',
    })
    expect(good.status).toBe(200)
    expect(h.issue).toHaveBeenCalledWith(900)

    h.issue.mockRejectedValueOnce(new Error('relay unavailable'))
    const relayFailure = await h.call('/api/whalemaid/temporary-password', 'POST', '{"ttlSec":900}', {
      ...clientHeaders,
      'content-type': 'application/json',
    })
    expect(relayFailure.status).toBe(502)
  })

  it('撤销并按逆注册顺序 disposal 两条路由', async () => {
    const h = harness()
    expect((await h.call('/api/whalemaid/temporary-password', 'DELETE', '', clientHeaders)).status).toBe(200)
    expect(h.revoke).toHaveBeenCalledOnce()
    h.dispose()
    expect(h.disposals).toEqual(['/api/whalemaid/temporary-password', '/api/whalemaid/device'])
  })
})
