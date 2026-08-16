/** WhaleMaid browser half: adds native image intake to the official composer. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { AttachmentButton, attachmentInjected } from './AttachmentButton.tsx'
import { TemporaryAccessPanel } from './TemporaryAccessPanel.tsx'
import { isControllerRuntime } from './runtime.ts'

/** Services used by the input-region registration. */
export const inject = ['slots']

/** Register only the controls owned by this runtime role. */
export function apply(ctx: ClientContext): void {
  if (isControllerRuntime()) {
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'whalemaid-attachments',
      order: 10,
      inject: attachmentInjected,
    }, AttachmentButton))
    return
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'whalemaid-temporary-access',
    order: 20,
  }, TemporaryAccessPanel))
}
