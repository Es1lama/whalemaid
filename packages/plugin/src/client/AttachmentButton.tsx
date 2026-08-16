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
import { appendTranscript, transcribeAudio } from './voice.ts'
import stylesheet from './AttachmentButton.css'

const classes = {
  root: 'whalemaid-attachment-root',
  button: 'whalemaid-attachment-button',
  menu: 'whalemaid-attachment-menu',
  option: 'whalemaid-attachment-option',
  stop: 'whalemaid-attachment-stop',
  recording: 'whalemaid-attachment-recording',
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
export function AttachmentButton({ input, inputActions, getBridge }: AttachmentButtonProps) {
  const bridge = getBridge()
  const rootRef = useRef<HTMLDivElement>(null)
  const recordingRef = useRef<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recordingHandle, setRecordingHandle] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => installStyles(), [])
  useEffect(() => () => {
    const handle = recordingRef.current
    if (handle !== null && bridge !== null) void bridge.cancelRecording({ handle }).catch(() => undefined)
  }, [bridge])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('pointerdown', close) }
  }, [open])

  if (bridge === null || inputActions === undefined) return null
  const disabled = busy || (recordingHandle === null && input.phase !== 'plain')
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
  const beginRecording = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await bridge.startRecording()
      if (typeof result.handle !== 'string' || result.handle === '') throw new Error('RECORDING_START_FAILED')
      recordingRef.current = result.handle
      setRecordingHandle(result.handle)
      setOpen(false)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '无法开始录音')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }
  const finishRecording = async (): Promise<void> => {
    const handle = recordingRef.current
    if (handle === null) return
    recordingRef.current = null
    setRecordingHandle(null)
    setBusy(true)
    setError(null)
    try {
      const response = await bridge.stopRecording({ handle })
      const [file] = await readNativeAssets(bridge, response)
      if (file === undefined) throw new Error('ASSET_UNREADABLE')
      const transcript = await transcribeAudio(file)
      inputActions.setDraft(appendTranscript(input.draft, transcript))
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '语音转录失败')
    } finally {
      setBusy(false)
    }
  }

  const buttonLabel = recordingHandle === null ? '添加图片或语音' : '停止录音'
  return (
    <div ref={rootRef} className={classes.root}>
      <Tooltip label={buttonLabel} side="top" delayMs={500}>
        <button
          type="button"
          className={classes.button}
          aria-label={buttonLabel}
          aria-expanded={recordingHandle === null ? open : undefined}
          aria-haspopup={recordingHandle === null ? 'menu' : undefined}
          disabled={disabled}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={() => {
            setError(null)
            if (recordingHandle !== null) void finishRecording()
            else setOpen(value => !value)
          }}
        >
          {recordingHandle === null
            ? <IconPaperclipOutline16 size={16} />
            : <span className={classes.stop} aria-hidden />}
        </button>
      </Tooltip>
      {open && (
        <div className={classes.menu} role="menu" aria-label="添加图片">
          <button type="button" className={classes.option} role="menuitem" disabled={busy} onClick={() => { void pick('camera') }}>拍照</button>
          <button type="button" className={classes.option} role="menuitem" disabled={busy} onClick={() => { void pick('gallery') }}>相册</button>
          <button type="button" className={classes.option} role="menuitem" disabled={busy} onClick={() => { void pick('file') }}>文件</button>
          <button type="button" className={classes.option} role="menuitem" disabled={busy} onClick={() => { void beginRecording() }}>录音</button>
        </div>
      )}
      {recordingHandle !== null && <div className={classes.recording} role="status">录音中</div>}
      {error !== null && <div className={classes.error} role="status" aria-live="polite">{error}</div>}
    </div>
  )
}

/** Client-side registration face for the input attachment contribution. */
export function attachmentInjected(): AttachmentInjected {
  return { getBridge: getNativeBridge }
}
