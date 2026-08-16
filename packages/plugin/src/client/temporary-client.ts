export type TemporaryPasswordState = 'none' | 'active' | 'consumed' | 'expired' | 'revoked'

export interface TemporaryPasswordView {
  password: string
  state: TemporaryPasswordState
  expiresAt: number
  generation: number
}

export interface DeviceAccessView {
  deviceId: string
  temporaryPassword: TemporaryPasswordView
}

const HEADERS = { 'x-whalemaid-client': '1' }

async function parse(response: Response): Promise<DeviceAccessView> {
  const body = await response.json() as DeviceAccessView & { error?: string }
  if (!response.ok) throw new Error(body.error || `请求失败 ${response.status}`)
  return body
}

export async function readDeviceAccess(request: typeof fetch = fetch): Promise<DeviceAccessView> {
  return parse(await request('/api/whalemaid/device', { headers: HEADERS }))
}

export async function issueTemporaryPassword(ttlSec: number, request: typeof fetch = fetch): Promise<DeviceAccessView> {
  return parse(await request('/api/whalemaid/temporary-password', {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ ttlSec }),
  }))
}

export async function revokeTemporaryPassword(request: typeof fetch = fetch): Promise<DeviceAccessView> {
  return parse(await request('/api/whalemaid/temporary-password', {
    method: 'DELETE',
    headers: HEADERS,
  }))
}
