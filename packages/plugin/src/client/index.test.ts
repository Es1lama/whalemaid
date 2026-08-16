import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ controller: false }))

vi.mock('./AttachmentButton.tsx', () => ({
  AttachmentButton: () => null,
  attachmentInjected: () => ({}),
}))
vi.mock('./TemporaryAccessPanel.tsx', () => ({ TemporaryAccessPanel: () => null }))
vi.mock('./runtime.ts', () => ({ isControllerRuntime: () => runtime.controller }))

function slotHarness() {
  const registered: Array<{ name: string; id?: string }> = []
  const inject = vi.fn((_name: string, install: () => unknown) => { install() })
  const register = vi.fn((options: { name: string; id?: string }) => {
    registered.push(options)
    return () => undefined
  })
  return { ctx: { slots: { inject, register } }, inject, registered }
}

beforeEach(() => { runtime.controller = false })

describe('WhaleMaid client slot registration', () => {
  it('控制端只注册原生附件入口', async () => {
    runtime.controller = true
    const { apply } = await import('./index.js')
    const { ctx, inject, registered } = slotHarness()

    apply(ctx as never)

    expect(inject.mock.calls.map(call => call[0])).toEqual(['conversation.input.left'])
    expect(registered).toEqual([{ name: 'conversation.input.left', id: 'whalemaid-attachments', order: 10, inject: expect.any(Function) }])
  })

  it('受控宿主只注册远程协助入口', async () => {
    const { apply } = await import('./index.js')
    const { ctx, inject, registered } = slotHarness()

    apply(ctx as never)

    expect(inject.mock.calls.map(call => call[0])).toEqual(['sidebar.footer.action'])
    expect(registered).toEqual([{ name: 'sidebar.footer.action', id: 'whalemaid-temporary-access', order: 20 }])
  })
})
