import { describe, expect, it, vi } from 'vitest'
import { issueTemporaryPassword, readDeviceAccess, revokeTemporaryPassword } from './temporary-client.js'

const body = {
  deviceId: 'WHALE-TEST-0001',
  temporaryPassword: { password: 'WMT-ABCD-EFGH', state: 'active', expiresAt: 2_000, generation: 1 },
}

function response(value: unknown = body, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('temporary password browser client', () => {
  it('每个请求都携带同源客户端 header', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())

    await readDeviceAccess(request)
    await issueTemporaryPassword(900, request)
    await revokeTemporaryPassword(request)

    for (const [, options] of request.mock.calls) {
      expect(options.headers['x-whalemaid-client']).toBe('1')
    }
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ ttlSec: 900 })
    expect(request.mock.calls[2][1].method).toBe('DELETE')
  })

  it('保留服务端可操作错误文案', async () => {
    const request = vi.fn().mockResolvedValue(response({ error: '设备尚无中继凭据' }, 502))
    await expect(issueTemporaryPassword(600, request)).rejects.toThrow('设备尚无中继凭据')
  })
})
