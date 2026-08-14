// SPEC: docs/protocol.md#PROTO-003 CredentialVerifier 抽象（宿主实现）
// SPEC: docs/threat-model.md#TM-009 抗暴力破解（限速 + 失败锁定）
import type { CredentialVerifier, DeviceId } from '@whalemaid/contract'
import type { Store } from './store.js'

const MAX_FAILS = 5
const LOCK_MS = 5 * 60_000

class FailCounter {
  private counts = new Map<string, { fails: number; lockedUntil: number }>()

  allowed(key: string): boolean {
    const e = this.counts.get(key)
    if (e && e.lockedUntil > Date.now()) return false
    return true
  }

  recordFail(key: string): void {
    const e = this.counts.get(key) ?? { fails: 0, lockedUntil: 0 }
    e.fails += 1
    if (e.fails >= MAX_FAILS) {
      e.fails = 0
      e.lockedUntil = Date.now() + LOCK_MS
    }
    this.counts.set(key, e)
  }

  recordSuccess(key: string): void {
    this.counts.delete(key)
  }
}

/** 长期密码/临时密码校验共用；校验通过即按 token 解析设备（TM-003 分层） */
export class PasswordVerifier implements CredentialVerifier {
  private fails = new FailCounter()

  constructor(private store: Store) {}

  /** 绑定流程专用：验密码（长期密码；临时密码 TODO REQ-003），成功返回 true */
  checkPassword(password: string, clientKey = ''): boolean {
    if (!this.fails.allowed(clientKey)) return false
    if (password === this.store.longPassword) {
      this.fails.recordSuccess(clientKey)
      return true
    }
    this.fails.recordFail(clientKey)
    return false
  }

  async verify(request: { header?: string; method: string }): Promise<DeviceId | null> {
    const header = request.header ?? ''
    if (!header.startsWith('Bearer ')) return null
    const token = header.slice('Bearer '.length)
    const device = this.store.findDeviceByToken(token)
    return device ? device.deviceId : null
  }
}
