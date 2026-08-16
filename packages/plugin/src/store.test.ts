// SPEC: docs/requirements.md#REQ-002 被控端设备与凭据单测（网关时代测试已随自定 RPC 废止删除，见 git 历史）
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateDeviceId, generatePassword } from './device.js'
import { Store } from './store.js'

/** 测试隔离：临时目录，不碰真实 ~/.dsh */
function tempDir(prefix = 'whalemaid-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function profileUrl(profileDir: string): string {
  return `${pathToFileURL(profileDir).href}/`
}

function testStore(): Store {
  return new Store({ dataDir: tempDir() })
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

  it('同一 profile 重启保持设备编号、密码和中继凭据（D-032）', () => {
    const profile = profileUrl(tempDir('whalemaid-profile-a-'))
    const store = new Store({ profileBaseUrl: profile })
    store.setRelayCredential('cred-123')

    const again = new Store({ profileBaseUrl: profile })
    expect(again.deviceId).toBe(store.deviceId)
    expect(again.longPassword).toBe(store.longPassword)
    expect(again.relayCredential).toBe('cred-123')
  })

  it('不同 profile 使用彼此独立的身份目录（D-032）', () => {
    const first = new Store({ profileBaseUrl: profileUrl(tempDir('whalemaid-profile-a-')) })
    const second = new Store({ profileBaseUrl: profileUrl(tempDir('whalemaid-profile-b-')) })
    first.setRelayCredential('credential-a')

    expect(second.deviceId).not.toBe(first.deviceId)
    expect(second.longPassword).not.toBe(first.longPassword)
    expect(second.relayCredential).toBe('')
    expect(first.file).not.toBe(second.file)
  })

  it('显式 dataDir 高于 profile 默认目录（D-032）', () => {
    const dataDir = tempDir('whalemaid-explicit-')
    const first = new Store({ dataDir, profileBaseUrl: profileUrl(tempDir('whalemaid-profile-a-')) })
    first.setRelayCredential('explicit-credential')

    const second = new Store({ dataDir, profileBaseUrl: profileUrl(tempDir('whalemaid-profile-b-')) })
    expect(second.deviceId).toBe(first.deviceId)
    expect(second.relayCredential).toBe('explicit-credential')
    expect(second.file).toBe(join(dataDir, 'store.json'))
  })

  it('没有显式目录或 profile 归属时拒绝创建共享身份（D-032）', () => {
    expect(() => new Store({})).toThrow(/profileBaseUrl/)
  })

  it('拒绝把非 file URL 当成 profile 目录（D-032）', () => {
    expect(() => new Store({ profileBaseUrl: 'https://example.invalid/profile/' })).toThrow(/file:/)
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
