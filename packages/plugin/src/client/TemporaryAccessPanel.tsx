import { useEffect, useMemo, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  IconCopyOutline16,
  IconRefreshOutline16,
  IconShareOutline16,
  IconTrashOutline16,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  issueTemporaryPassword,
  readDeviceAccess,
  revokeTemporaryPassword,
  type DeviceAccessView,
  type TemporaryPasswordState,
} from './temporary-client.ts'
import stylesheet from './TemporaryAccessPanel.css'
import { writeClipboardText } from './native.ts'

type TemporaryAccessPanelProps = PropsRuntime<'sidebar.footer.action'>

function installStyles(): () => void {
  const existing = document.querySelector('style[data-whalemaid-access]')
  if (existing !== null) return () => undefined
  const style = document.createElement('style')
  style.dataset.whalemaidAccess = ''
  style.textContent = stylesheet
  document.head.append(style)
  return () => { style.remove() }
}

function stateLabel(state: TemporaryPasswordState): string {
  switch (state) {
    case 'none': return '尚未生成'
    case 'active': return '可使用一次'
    case 'consumed': return '已使用'
    case 'expired': return '已过期'
    case 'revoked': return '已撤销'
  }
}

function remainingLabel(expiresAt: number, now: number): string {
  const seconds = Math.max(0, expiresAt - now)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes >= 60) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

export function TemporaryAccessPanel({ wide }: TemporaryAccessPanelProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<DeviceAccessView | null>(null)
  const [ttlSec, setTtlSec] = useState(600)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => installStyles(), [])
  useEffect(() => {
    if (!open) return
    setBusy(true)
    setError(null)
    void readDeviceAccess()
      .then(setView)
      .catch(cause => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setBusy(false) })
  }, [open])
  useEffect(() => {
    if (!open || view?.temporaryPassword.state !== 'active') return
    const timer = window.setInterval(() => { setNow(Math.floor(Date.now() / 1000)) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [open, view?.temporaryPassword.state])

  const temporary = view?.temporaryPassword
  const remaining = useMemo(
    () => temporary?.state === 'active' ? remainingLabel(temporary.expiresAt, now) : null,
    [now, temporary],
  )
  const issue = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setCopied(null)
    try {
      setView(await issueTemporaryPassword(ttlSec))
      setNow(Math.floor(Date.now() / 1000))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setView(await revokeTemporaryPassword())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const copy = async (label: string, value: string): Promise<void> => {
    try {
      await writeClipboardText(value)
      setCopied(label)
      window.setTimeout(() => { setCopied(current => current === label ? null : current) }, 1500)
    } catch {
      setError('复制失败，请手动选择')
    }
  }

  const trigger = (
    <button
      type="button"
      className="whalemaid-access-trigger"
      aria-label="远程协助"
      aria-expanded={open}
      onClick={() => { setOpen(true) }}
    >
      <IconShareOutline16 size={16} />
      {wide && <span className="whalemaid-access-trigger-label">远程协助</span>}
    </button>
  )

  return (
    <>
      {wide ? trigger : <Tooltip label="远程协助" side="right" delayMs={500}>{trigger}</Tooltip>}
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title="远程协助"
        closeLabel="关闭"
        description="短期密码仅可使用一次，到期或撤销后立即失效。"
        className="whalemaid-access-dialog"
      >
        <div className="whalemaid-access-body">
          <div className="whalemaid-access-field">
            <span className="whalemaid-access-label">设备编号</span>
            <div className="whalemaid-access-value-row">
              <span className="whalemaid-access-code">{view?.deviceId ?? (busy ? '读取中' : '-')}</span>
              {view?.deviceId && (
                <Tooltip label="复制设备编号" side="top" delayMs={400}>
                  <button type="button" className="whalemaid-access-icon-button" aria-label="复制设备编号" onClick={() => { void copy('device', view.deviceId) }}>
                    <IconCopyOutline16 size={16} />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>

          <label className="whalemaid-access-field">
            <span className="whalemaid-access-label">有效期</span>
            <select className="whalemaid-access-select" value={ttlSec} disabled={busy} onChange={event => { setTtlSec(Number(event.target.value)) }}>
              <option value={600}>10 分钟</option>
              <option value={1800}>30 分钟</option>
              <option value={3600}>1 小时</option>
              <option value={14400}>4 小时</option>
            </select>
          </label>

          <div className="whalemaid-access-field">
            <span className="whalemaid-access-label">短期密码</span>
            <div className="whalemaid-access-value-row">
              <span className="whalemaid-access-code whalemaid-access-password">
                {temporary?.password || stateLabel(temporary?.state ?? 'none')}
              </span>
              {temporary?.password && (
                <Tooltip label="复制短期密码" side="top" delayMs={400}>
                  <button type="button" className="whalemaid-access-icon-button" aria-label="复制短期密码" onClick={() => { void copy('password', temporary.password) }}>
                    <IconCopyOutline16 size={16} />
                  </button>
                </Tooltip>
              )}
            </div>
            {temporary && (
              <span className="whalemaid-access-status" role="status">
                {stateLabel(temporary.state)}{remaining !== null ? `，剩余 ${remaining}` : ''}{copied !== null ? '，已复制' : ''}
              </span>
            )}
          </div>

          {error !== null && <p className="whalemaid-access-error" role="alert">{error}</p>}

          <div className="whalemaid-access-actions">
            <button type="button" className="whalemaid-access-button" disabled={busy} onClick={() => { void issue() }}>
              <IconRefreshOutline16 size={16} />
              {temporary?.state === 'active' ? '刷新密码' : '生成密码'}
            </button>
            <button type="button" className="whalemaid-access-button" disabled={busy || temporary?.state !== 'active'} onClick={() => { void revoke() }}>
              <IconTrashOutline16 size={16} />
              撤销
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
