import { describe, expect, it, vi } from 'vitest'

vi.mock('./AttachmentButton.tsx', () => ({
  AttachmentButton: () => null,
  attachmentInjected: () => ({}),
}))
vi.mock('./TemporaryAccessPanel.tsx', () => ({ TemporaryAccessPanel: () => null }))

describe('WhaleMaid client slot registration', () => {
  it('同时注册附件入口与无会话也可见的远程协助入口', async () => {
    const { apply } = await import('./index.js')
    const registered: Array<{ name: string; id?: string }> = []
    const inject = vi.fn((_name: string, install: () => unknown) => { install() })
    const register = vi.fn((options: { name: string; id?: string }) => {
      registered.push(options)
      return () => undefined
    })
    const ctx = { slots: { inject, register } }

    apply(ctx as never)

    expect(inject.mock.calls.map(call => call[0])).toEqual([
      'conversation.input.left',
      'sidebar.footer.action',
    ])
    expect(registered.map(({ name, id }) => ({ name, id }))).toEqual([
      { name: 'conversation.input.left', id: 'whalemaid-attachments' },
      { name: 'sidebar.footer.action', id: 'whalemaid-temporary-access' },
    ])
  })
})
