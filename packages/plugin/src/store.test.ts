// SPEC: docs/requirements.md#REQ-002 被控端设备与凭据单测（网关时代测试已随自定 RPC 废止删除，见 git 历史）
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkSync, lockSync } from 'proper-lockfile'
import { describe, expect, it } from 'vitest'
import { generateDeviceId, generatePassword, generateTemporaryPassword } from './device.js'
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

describe('generateTemporaryPassword', () => {
  it('使用独立 WMT 格式且每次随机（REQ-003）', () => {
    expect(generateTemporaryPassword()).toMatch(/^WMT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword())
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
    const deviceId = store.deviceId
    const longPassword = store.longPassword
    store.close()

    const again = new Store({ profileBaseUrl: profile })
    expect(again.deviceId).toBe(deviceId)
    expect(again.longPassword).toBe(longPassword)
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
    const deviceId = first.deviceId
    first.close()

    const second = new Store({ dataDir, profileBaseUrl: profileUrl(tempDir('whalemaid-profile-b-')) })
    expect(second.deviceId).toBe(deviceId)
    expect(second.relayCredential).toBe('explicit-credential')
    expect(second.file).toBe(join(realpathSync(dataDir), 'store.json'))
  })

  it('没有显式目录或 profile 归属时拒绝创建共享身份（D-032）', () => {
    expect(() => new Store({})).toThrow(/profileBaseUrl/)
  })

  it('已有外部 owner 时拒绝同 profile 第二个 DSH 进程（D-032）', () => {
    const dataDir = tempDir('whalemaid-foreign-owner-')
    mkdirSync(dataDir, { recursive: true })
    const releaseForeignOwner = lockSync(join(dataDir, 'store.json'), {
      realpath: false,
      stale: 30_000,
      update: 10_000,
    })

    expect(() => new Store({ dataDir })).toThrow(/另一个 DSH 进程/)
    releaseForeignOwner()
    const recovered = new Store({ dataDir })
    recovered.close()
  })

  it('同进程 HMR 可重入，最后一个 owner disposal 后释放锁（D-032）', () => {
    const dataDir = tempDir('whalemaid-hmr-owner-')
    const first = new Store({ dataDir })
    const second = new Store({ dataDir })

    expect(second.deviceId).toBe(first.deviceId)
    expect(checkSync(first.file, { realpath: false, stale: 30_000 })).toBe(true)
    first.close()
    expect(checkSync(second.file, { realpath: false, stale: 30_000 })).toBe(true)
    first.close()
    second.close()
    expect(checkSync(second.file, { realpath: false, stale: 30_000 })).toBe(false)
  })

  it('拒绝把非 file URL 当成 profile 目录（D-032）', () => {
    expect(() => new Store({ profileBaseUrl: 'https://example.invalid/profile/' })).toThrow(/file:/)
  })

  it('临时密码状态按 profile 持久化，消费后清除可分享明文（REQ-003）', () => {
    const dataDir = tempDir('whalemaid-temporary-state-')
    const store = new Store({ dataDir })
    store.setTemporaryPassword({
      password: 'WMT-ABCD-EFGH',
      expiresAt: 2_000,
      generation: 3,
      state: 'active',
    })
    store.close()

    const again = new Store({ dataDir })
    expect(again.temporaryPassword).toEqual({
      password: 'WMT-ABCD-EFGH',
      expiresAt: 2_000,
      generation: 3,
      state: 'active',
    })
    again.syncTemporaryPasswordStatus({ expiresAt: 2_000, generation: 3, state: 'consumed' })
    expect(again.temporaryPassword.password).toBe('')
    expect(again.temporaryPassword.state).toBe('consumed')
  })

  it('旧 generation 心跳不能覆盖新签发密码（REQ-003）', () => {
    const store = testStore()
    store.setTemporaryPassword({
      password: 'WMT-NEW1-PASS',
      expiresAt: 3_000,
      generation: 5,
      state: 'active',
    })
    store.syncTemporaryPasswordStatus({ expiresAt: 2_000, generation: 4, state: 'consumed' })
    expect(store.temporaryPassword.password).toBe('WMT-NEW1-PASS')
    expect(store.temporaryPassword.generation).toBe(5)
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
