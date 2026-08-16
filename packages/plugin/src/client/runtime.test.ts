import { afterEach, describe, expect, it, vi } from 'vitest'
import { isControllerRuntime } from './runtime.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('controller runtime identity', () => {
  it('requires the exact controller role stamped by the native shell', () => {
    vi.stubGlobal('__WHALEMAID_RUNTIME_ROLE__', 'controller')
    expect(isControllerRuntime()).toBe(true)

    vi.stubGlobal('__WHALEMAID_RUNTIME_ROLE__', 'host')
    expect(isControllerRuntime()).toBe(false)
  })

  it('defaults to controlled-host presentation in a direct browser', () => {
    expect(isControllerRuntime()).toBe(false)
  })
})
