// SPEC: docs/requirements.md#REQ-002/015 契约级校验
import { describe, expect, it } from 'vitest'
import { DEVICE_ID_PATTERN, PROTOCOL_VERSION } from './index.js'

describe('DEVICE_ID_PATTERN', () => {
  it('接受 WHALE-XXXX-XXXX', () => {
    expect(DEVICE_ID_PATTERN.test('WHALE-ABCD-EFGH')).toBe(true)
  })
  it('拒绝易混字符与错误格式', () => {
    expect(DEVICE_ID_PATTERN.test('WHALE-AB01-EFGH')).toBe(false)
    expect(DEVICE_ID_PATTERN.test('whale-abcd-efgh')).toBe(false)
    expect(DEVICE_ID_PATTERN.test('WHALE-ABCD-EFG')).toBe(false)
  })
})

describe('信封版本', () => {
  it('版本号为 1', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })
})
