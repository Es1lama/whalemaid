import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { IconPaperclipOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  getNativeBridge,
  pasteFilesIntoComposer,
  readNativeAssets,
  type WhaleMaidNativeBridge,
} from './native.ts'
import stylesheet from './AttachmentButton.css'

const classes = {
  root: 'whalemaid-attachment-root',
  button: 'whalemaid-attachment-button',
  menu: 'whalemaid-attachment-menu',
  option: 'whalemaid-attachment-option',
  error: 'whalemaid-attachment-error',
} as const

interface AttachmentInjected {
  readonly getBridge: () => WhaleMaidNativeBridge | null
}

type AttachmentButtonProps = PropsRuntime<'conversation.input.left'> & InjectFace<AttachmentInjected>
type PickKind = 'camera' | 'gallery' | 'file'

function installStyles(): () => void {
  const existing = document.querySelector('style[data-whalemaid-attachments]')
  if (existing !== null) return () => undefined
  const style = document.createElement('style')
  style.dataset.whalemaidAttachments = ''
  style.textContent = stylesheet
  document.head.append(style)
  return () => { style.remove() }
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === 'USER_CANCELLED'
}

/** Native attachment control that sends browser Files through InputBar's official paste intake. */
export function AttachmentButton({ input, getBridge }: AttachmentButtonProps) {
  const bridge = getBridge()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => installStyles(), [])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('pointerdown', close) }
  }, [open])

  if (bridge === null) return null
  const disabled = busy || input.phase !== 'plain'
  const pick = async (kind: PickKind): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const response = kind === 'camera'
        ? await bridge.capturePhoto()
        : kind === 'gallery'
          ? await bridge.pickGallery({ multiple: true })
          : await bridge.pickFiles({ multiple: true, mimeTypes: ['image/*'] })
      const files = await readNativeAssets(bridge, response)
      if (!pasteFilesIntoComposer(files)) throw new Error('INPUT_UNAVAILABLE')
      setOpen(false)
    } catch (cause: unknown) {
      if (!isCancelled(cause)) setError('附件读取失败，请重试')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className={classes.root}>
      <Tooltip label="添加图片" side="top" delayMs={500}>
        <button
          type="button"
          className={classes.button}
          aria-label="添加图片"
          aria-expanded={open}
          aria-haspopup="menu"
          disabled={disabled}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={() => { setError(null); setOpen(value => !value) }}
        >
          <IconPaperclipOutline16 size={16} />
        </button>
      </Tooltip>
      {open && (
        <div className={classes.menu} role="menu" aria-label="添加图片">
          <button type="button" className={classes.option} role="menuitem" disabled={busy} onClick={() => { void pick('camera') }}>拍照</button>
          <button type="button" className={classes.option} role="menuitem" disabled={busy} onClick={() => { void pick('gallery') }}>相册</button>
          <button type="button" className={classes.option} role="menuitem" disabled={busy} onClick={() => { void pick('file') }}>文件</button>
        </div>
      )}
      {error !== null && <div className={classes.error} role="status" aria-live="polite">{error}</div>}
    </div>
  )
}

/** Client-side registration face for the input attachment contribution. */
export function attachmentInjected(): AttachmentInjected {
  return { getBridge: getNativeBridge }
}
