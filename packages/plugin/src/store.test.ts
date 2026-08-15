// SPEC: docs/requirements.md#REQ-002 被控端设备与凭据单测（网关时代测试已随自定 RPC 废止删除，见 git 历史）
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateDeviceId, generatePassword } from './device.js'
import { Store } from './store.js'

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
  it('初始即生成设备编号与长期密码并落盘（UX-001/002）', () => {
    const store = testStore()
    expect(store.deviceId).toMatch(/^WHALE-/)
    expect(store.longPassword).toHaveLength(12)
  })

  it('中继凭据持久化（SEC-001）', () => {
    const store = testStore()
    expect(store.relayCredential).toBe('')
    store.setRelayCredential('cred-123')
    // 重新加载同一目录（等价重启）仍可读回
    const again = new Store(store.file.replace(/store\.json$/, ''))
    expect(again.relayCredential).toBe('cred-123')
  })

  it('重生成密码清凭据触发重注册（REQ-002）', () => {
    const store = testStore()
    store.setRelayCredential('cred-123')
    const old = store.longPassword
    const next = store.rotatePassword()
    expect(next).not.toBe(old)
    expect(store.relayCredential).toBe('') // 凭据清空 → 插件重注册上报新哈希
  })
})
