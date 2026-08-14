// SPEC: docs/requirements.md#REQ-002/004 被控端设备与凭据单测
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateDeviceId, generateNonce, generatePassword } from './device.js'
import { Store, digest } from './store.js'

/** 测试隔离：临时目录，不碰真实 ~/.dsh */
function testStore(): Store {
  return new Store(mkdtempSync(join(tmpdir(), 'whalemaid-test-')))
}

describe('generateDeviceId', () => {
  it('符合 WHALE-XXXX-XXXX 且不含易混字符', () => {
    const id = generateDeviceId()
    expect(id).toMatch(/^WHALE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  })
})

describe('generatePassword', () => {
  it('12 字符且两次不同', () => {
    expect(generatePassword()).toHaveLength(12)
    expect(generatePassword()).not.toBe(generatePassword())
  })
})

describe('Store', () => {
  it('token 只存摘要；吊销后查找失效（TM-003/005）', () => {
    const store = testStore()
    const token = store.issueToken('WHALE-AAAA-BBBB')
    expect(store.findDeviceByToken(token)?.deviceId).toBe('WHALE-AAAA-BBBB')
    store.revokeDevice('WHALE-AAAA-BBBB')
    expect(store.findDeviceByToken(token)).toBeUndefined()
  })

  it('nonce 一次性（TM-004）', () => {
    const store = testStore()
    const jwk = { kty: 'EC', crv: 'P-256' } as JsonWebKey
    const nonce = store.addNonce('WHALE-AAAA-BBBB', jwk)
    expect(store.takeNonce(nonce)?.deviceId).toBe('WHALE-AAAA-BBBB')
    expect(store.takeNonce(nonce)).toBeNull()
  })

  it('digest 稳定', () => {
    expect(digest('x')).toBe(digest('x'))
  })

  it('临时密码一次性且过期（REQ-003）', () => {
    const store = testStore()
    const pw = store.issueTemporaryPassword()
    expect(store.consumeTemporaryPassword(pw)).toBe(true)
    expect(store.consumeTemporaryPassword(pw)).toBe(false) // 用过即焚
    const pw2 = store.issueTemporaryPassword(0)
    expect(store.consumeTemporaryPassword(pw2)).toBe(false) // 立即过期
  })

  it('临时 token 短 TTL 可验证（REQ-003）', () => {
    const store = testStore()
    const token = store.issueTemporaryToken('WHALE-AAAA-BBBB', 1000)
    expect(store.findTemporaryToken(token)?.deviceId).toBe('WHALE-AAAA-BBBB')
  })
})
