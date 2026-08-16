import { generateTemporaryPassword } from './device.js'
import type { TemporaryPasswordStatus } from './relay.js'
import { Store, type TemporaryPasswordRecord } from './store.js'

export interface TemporaryPasswordRelay {
  issueTemporaryPassword(password: string, ttlSec: number): Promise<TemporaryPasswordStatus>
  revokeTemporaryPassword(): Promise<void>
}

export class TemporaryPasswordManager {
  constructor(private store: Store, private relay: TemporaryPasswordRelay) {}

  snapshot(now = Math.floor(Date.now() / 1000)): TemporaryPasswordRecord {
    const current = this.store.temporaryPassword
    if (current.state === 'active' && now > current.expiresAt) {
      this.store.syncTemporaryPasswordStatus({
        state: 'expired',
        expiresAt: current.expiresAt,
        generation: current.generation,
      })
    }
    return this.store.temporaryPassword
  }

  async issue(ttlSec: number): Promise<TemporaryPasswordRecord> {
    if (!Number.isInteger(ttlSec) || ttlSec < 60 || ttlSec > 86_400) {
      throw new Error('ttlSec 必须是 60 到 86400 之间的整数')
    }
    const password = generateTemporaryPassword()
    const issued = await this.relay.issueTemporaryPassword(password, ttlSec)
    if (issued.state !== 'active') throw new Error(`中继返回了无效临时密码状态: ${issued.state}`)
    const record: TemporaryPasswordRecord = { password, ...issued }
    this.store.setTemporaryPassword(record)
    return record
  }

  async revoke(): Promise<void> {
    await this.relay.revokeTemporaryPassword()
    const current = this.store.temporaryPassword
    this.store.syncTemporaryPasswordStatus({
      state: 'revoked',
      expiresAt: current.expiresAt,
      generation: current.generation,
    })
  }
}
