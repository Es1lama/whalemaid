/** WhaleMaid browser half: adds native image intake to the official composer. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AttachmentButton, attachmentInjected } from './AttachmentButton.tsx'

/** Services used by the input-region registration. */
export const inject = ['slots']

/** Register the native attachment control only while the official input slot exists. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'whalemaid-attachments',
    order: 10,
    inject: attachmentInjected,
  }, AttachmentButton))
}
