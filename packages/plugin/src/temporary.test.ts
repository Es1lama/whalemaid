import { describe, expect, it, vi } from 'vitest'
import { Store } from './store.js'
import { TemporaryPasswordManager } from './temporary.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function testStore(): Store {
  return new Store({ dataDir: mkdtempSync(join(tmpdir(), 'whalemaid-temporary-manager-')) })
}

describe('TemporaryPasswordManager', () => {
  it('只在 relay 签发成功后发布临时密码', async () => {
    const store = testStore()
    const issue = vi.fn().mockResolvedValue({ state: 'active', expiresAt: 2_000, generation: 4 })
    const manager = new TemporaryPasswordManager(store, { issueTemporaryPassword: issue, revokeTemporaryPassword: vi.fn() })

    const result = await manager.issue(600)
    expect(result.password).toMatch(/^WMT-/)
    expect(issue).toHaveBeenCalledWith(result.password, 600)
    expect(store.temporaryPassword).toEqual(result)
  })

  it('relay 失败时保留此前可用状态', async () => {
    const store = testStore()
    store.setTemporaryPassword({ password: 'WMT-OLD1-PASS', state: 'active', expiresAt: 2_000, generation: 3 })
    const manager = new TemporaryPasswordManager(store, {
      issueTemporaryPassword: vi.fn().mockRejectedValue(new Error('relay unavailable')),
      revokeTemporaryPassword: vi.fn(),
    })

    await expect(manager.issue(600)).rejects.toThrow('relay unavailable')
    expect(store.temporaryPassword.password).toBe('WMT-OLD1-PASS')
  })

  it('限制 TTL，并在读取时清除已过期明文', async () => {
    const store = testStore()
    const manager = new TemporaryPasswordManager(store, {
      issueTemporaryPassword: vi.fn(),
      revokeTemporaryPassword: vi.fn(),
    })
    await expect(manager.issue(59)).rejects.toThrow(/60/)
    await expect(manager.issue(86_401)).rejects.toThrow(/86400/)

    store.setTemporaryPassword({ password: 'WMT-TIME-OUT1', state: 'active', expiresAt: 1_000, generation: 2 })
    expect(manager.snapshot(1_001)).toEqual({ password: '', state: 'expired', expiresAt: 1_000, generation: 2 })
  })

  it('relay 撤销成功后清除明文并保留 generation', async () => {
    const store = testStore()
    store.setTemporaryPassword({ password: 'WMT-REVO-KED1', state: 'active', expiresAt: 2_000, generation: 5 })
    const revokeTemporaryPassword = vi.fn().mockResolvedValue(undefined)
    const manager = new TemporaryPasswordManager(store, {
      issueTemporaryPassword: vi.fn(),
      revokeTemporaryPassword,
    })

    await manager.revoke()
    expect(revokeTemporaryPassword).toHaveBeenCalledOnce()
    expect(store.temporaryPassword).toEqual({ password: '', state: 'revoked', expiresAt: 2_000, generation: 5 })
  })
})
