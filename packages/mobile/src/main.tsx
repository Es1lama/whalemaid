// SPEC: docs/requirements.md#REQ-001..011 移动端业务视图
// 骨架完整版：登录(长期/临时双模式) → 主页(工作区/会话) → 目录浏览器(REQ-009) → 聊天(REQ-005/006/007/008/010/011)
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { DEVICE_ID_PATTERN } from '@whalemaid/contract'
import { WhaleClient } from './api/client.js'
import { exportPublicJwk, getOrCreateKeypair, signNonce } from './crypto/device-key.js'

type View = 'login' | 'home' | 'chat'

const input: CSSProperties = { display: 'block', width: '100%', boxSizing: 'border-box', margin: '6px 0', padding: 10, fontSize: 16 }
const btn: CSSProperties = { display: 'block', width: '100%', margin: '6px 0', padding: 12, fontSize: 16 }
const card: CSSProperties = { padding: 12, margin: '8px 0', background: '#fff', borderRadius: 10, border: '1px solid #e3e8ef' }

/** 从 DSH HistoryEntry 尽力提取可显示文本（精确渲染 TODO 待 HistoryEntry 类型对齐） */
function extractText(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object' || depth > 3) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (['content', 'text', 'delta', 'title', 'name', 'prompt', 'message'].includes(k)) out.push(...extractText(v, depth + 1))
  }
  return out
}

/** REQ-010 目录模式：按 markdown 标题建 TOC */
function tocFromText(text: string): Array<{ level: number; title: string; anchor: string }> {
  const items: Array<{ level: number; title: string; anchor: string }> = []
  for (const line of text.split('\n')) {
    const m = /^(#{1,4})\s+(.+)$/.exec(line)
    if (m) items.push({ level: m[1].length, title: m[2].slice(0, 60), anchor: `h-${items.length}` })
  }
  return items
}

function App() {
  const [view, setView] = useState<View>('login')
  const [client, setClient] = useState<WhaleClient | null>(null)
  const [chatSession, setChatSession] = useState('')

  useEffect(() => {
    const base = localStorage.getItem('whalemaid.base')
    const token = localStorage.getItem('whalemaid.token')
    if (base && token) {
      const c = new WhaleClient(base)
      c.setToken(token)
      setClient(c)
      setView('home')
    }
  }, [])

  const connect = useCallback(async (base: string, deviceId: string, password: string, temporary: boolean) => {
    const c = new WhaleClient(base.replace(/\/$/, ''))
    try {
      let deviceToken: string
      if (temporary) {
        ;({ deviceToken } = await c.bindTemporary({ deviceId, password }))
      } else {
        const pair = await getOrCreateKeypair()
        const jwk = await exportPublicJwk(pair)
        const { nonce } = await c.handshake({ deviceId, publicKeyJwk: jwk })
        const sig = await signNonce(pair, nonce)
        ;({ deviceToken } = await c.bind({ deviceId, nonce, password, nonceSignature: sig }))
      }
      c.setToken(deviceToken)
      localStorage.setItem('whalemaid.base', c.endpoint)
      localStorage.setItem('whalemaid.deviceId', deviceId)
      localStorage.setItem('whalemaid.token', deviceToken)
      setClient(c)
      setView('home')
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }, [])

  if (!client) return <LoginView onConnect={connect} />
  if (view === 'chat' && chatSession) {
    return <ChatView client={client} sessionId={chatSession} onBack={() => setView('home')} />
  }
  return <HomeView client={client} onOpenSession={(id) => { setChatSession(id); setView('chat') }} />
}

function LoginView({ onConnect }: { onConnect: (base: string, deviceId: string, password: string, temporary: boolean) => Promise<string | null> }) {
  const [base, setBase] = useState(() => localStorage.getItem('whalemaid.base') ?? '')
  const [deviceId, setDeviceId] = useState(() => localStorage.getItem('whalemaid.deviceId') ?? '')
  const [password, setPassword] = useState('')
  const [temporary, setTemporary] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
      <h1>🐳 WhaleMaid</h1>
      <p style={{ color: '#667' }}>让手机完全接管电脑上的 DeepSeek Harness</p>
      <input style={input} value={base} onChange={(e) => setBase(e.target.value)} placeholder="主机地址 http://192.168.x.x:3180" />
      <input style={input} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="设备 ID：WHALE-XXXX-XXXX" />
      <input style={input} value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={temporary ? '临时密码（一次性/限时）' : '长期密码'} />
      <label style={{ display: 'block', margin: '6px 0' }}>
        <input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} /> 使用临时密码（借朋友/临时设备）
      </label>
      {error && <p style={{ color: '#c33' }}>{error}</p>}
      <button
        style={btn}
        disabled={busy || !DEVICE_ID_PATTERN.test(deviceId) || !password}
        onClick={async () => {
          setBusy(true)
          const err = await onConnect(base, deviceId, password, temporary)
          setBusy(false)
          if (err) setError(err)
        }}
      >
        连接
      </button>
    </main>
  )
}

function HomeView({ client, onOpenSession }: { client: WhaleClient; onOpenSession: (id: string) => void }) {
  const [workspaces, setWorkspaces] = useState<unknown[]>([])
  const [sessions, setSessions] = useState<Array<{ sessionId: string; title?: string; blank?: boolean }>>([])
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [w, s] = await Promise.all([client.workspaceList(), client.sessionList()])
      setWorkspaces(((w as { items?: unknown[] })?.items ?? []) as unknown[])
      setSessions((((s as { items?: unknown[] })?.items ?? []) as Array<{ sessionId: string; title?: string; blank?: boolean }>).filter((x) => !x.blank))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
      <h1>🐳 WhaleMaid</h1>
      {error && <p style={{ color: '#c33' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          style={btn}
          onClick={async () => {
            try {
              const r = (await client.sessionCreate({})) as { sessionId?: string }
              if (r.sessionId) onOpenSession(r.sessionId)
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          ＋ 新建会话
        </button>
        <button style={btn} onClick={() => setBrowsing(true)}>
          ＋ 新建工作区
        </button>
      </div>

      <h3>工作区</h3>
      {(workspaces as Array<{ workspaceId: string; title?: string; path?: string }>).map((w) => (
        <div key={w.workspaceId} style={card}>
          <strong>{w.title ?? w.workspaceId}</strong>
          <div style={{ color: '#889', fontSize: 12 }}>{w.path}</div>
        </div>
      ))}

      <h3>会话（REQ-005 原生会话）</h3>
      {sessions.map((s) => (
        <div key={s.sessionId} style={card} onClick={() => onOpenSession(s.sessionId)}>
          <strong>{s.title ?? s.sessionId}</strong>
        </div>
      ))}

      {browsing && <DirectoryBrowser client={client} onClose={() => setBrowsing(false)} onOpened={(sessionId) => { setBrowsing(false); onOpenSession(sessionId) }} />}
    </main>
  )
}

/** REQ-009 工作区创建：浏览主机目录 → 建/选文件夹 → workspace.create → 开会话 */
function DirectoryBrowser({ client, onClose, onOpened }: { client: WhaleClient; onClose: () => void; onOpened: (sessionId: string) => void }) {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<Array<{ name: string; hidden?: boolean }>>([])
  const [crumbs, setCrumbs] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const nav = useCallback(
    async (p?: string) => {
      setBusy(true)
      setError('')
      try {
        const r = (await client.listDirectory(p === undefined ? {} : { path: p })) as {
          path: string
          entries?: Array<{ name: string; hidden?: boolean }>
          crumbs?: string[]
          truncated?: boolean
        }
        setPath(r.path)
        setEntries((r.entries ?? []).filter((e) => !e.hidden))
        setCrumbs(r.crumbs ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [client],
  )

  useEffect(() => {
    void nav()
  }, [nav])

  const choose = async () => {
    setBusy(true)
    try {
      const w = (await client.workspaceCreate({ path })) as { workspaceId?: string }
      if (!w.workspaceId) throw new Error('workspace.create 未返回 workspaceId')
      const s = (await client.sessionCreate({ workspaceId: w.workspaceId })) as { sessionId?: string }
      if (s.sessionId) onOpened(s.sessionId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', width: '92%', maxWidth: 520, maxHeight: '80%', overflow: 'auto', borderRadius: 12, padding: 16 }}>
        <h3>选择工作区目录</h3>
        <div style={{ color: '#889', fontSize: 12, wordBreak: 'break-all' }}>
          {crumbs.slice(0, -1).map((c, i) => (
            <span key={i}>
              <a onClick={() => nav(c)}>{c === '/' ? '根' : c.split('/').pop()}</a> /{' '}
            </span>
          ))}
          <strong>{path}</strong>
        </div>
        {error && <p style={{ color: '#c33' }}>{error}</p>}
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          {entries.map((e) => (
            <div key={e.name} style={{ padding: '8px 4px', borderBottom: '1px solid #eee' }} onClick={() => nav(`${path === '/' ? '' : path}/${e.name}`)}>
              📁 {e.name}
            </div>
          ))}
        </div>
        <input style={input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新文件夹名" />
        <button
          style={btn}
          disabled={!newName || busy}
          onClick={async () => {
            await client.createDirectory({ path, name: newName })
            setNewName('')
            await nav(path)
          }}
        >
          新建文件夹
        </button>
        <button style={btn} disabled={busy || !path} onClick={choose}>
          选择此目录并创建工作区
        </button>
        <button style={btn} onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  )
}

/** 聊天视图：历史 + SSE + 模型/思考强度 + 权限预设 + 停止 + TOC(REQ-010) + 引用复制(REQ-011) */
function ChatView({ client, sessionId, onBack }: { client: WhaleClient; sessionId: string; onBack: () => void }) {
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([])
  const [draft, setDraft] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [toc, setToc] = useState<Array<{ level: number; title: string; anchor: string }>>([])
  const [showToc, setShowToc] = useState(false)
  const [selection, setSelection] = useState({ text: '', x: 0, y: 0 })
  const boxRef = useRef<HTMLDivElement>(null)

  const loadHistory = useCallback(async () => {
    try {
      const r = (await client.sessionHistory({ sessionId, maxMessages: 50 })) as { events?: unknown[] }
      const msgs: Array<{ role: string; text: string }> = []
      for (const ev of r.events ?? []) {
        const chunks = extractText(ev)
        if (chunks.length) msgs.push({ role: 'assistant', text: chunks.join('\n') })
      }
      setMessages(msgs)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [client, sessionId])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const off = client.events(
      (frame) => {
        if (frame.type === 'turn-status') {
          const p = frame.payload as { status?: string }
          setRunning(p?.status === 'running')
          if (p?.status === 'done') void loadHistory()
        }
      },
      () => void 0,
    )
    return off
  }, [client, loadHistory])

  const fullText = messages.map((m) => m.text).join('\n\n')
  useEffect(() => setToc(tocFromText(fullText)), [fullText])

  const copySelection = async () => {
    const sel = window.getSelection()?.toString() ?? ''
    if (sel) await navigator.clipboard.writeText(sel)
    setSelection({ text: '', x: 0, y: 0 })
  }

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={onBack}>←</button>
        <h2 style={{ flex: 1 }}>会话</h2>
        <button disabled={toc.length === 0} onClick={() => setShowToc(!showToc)}>
          目录
        </button>
      </div>
      {error && <p style={{ color: '#c33' }}>{error}</p>}
      {showToc && (
        <div style={card}>
          {toc.map((t) => {
            // 按标题定位到包含它的消息块（消息以原文渲染，标题即文本行）
            const idx = messages.findIndex((m) => m.text.includes(t.title))
            return (
              <div key={t.anchor} style={{ paddingLeft: (t.level - 1) * 12 }} onClick={() => (idx >= 0 ? document.getElementById(`m-${idx}`)?.scrollIntoView() : undefined)}>
                {'#'.repeat(t.level)} {t.title}
              </div>
            )
          })}
        </div>
      )}
      <div
        ref={boxRef}
        style={{ minHeight: 200, background: '#f8fafc', borderRadius: 10, padding: 12 }}
        onMouseUp={(e) => {
          const text = window.getSelection()?.toString() ?? ''
          if (text.length > 0) setSelection({ text, x: e.clientX, y: e.clientY })
        }}
      >
        {messages.map((m, i) => (
          <div key={i} style={{ margin: '8px 0' }}>
            <div style={{ color: '#889', fontSize: 11 }}>{m.role}</div>
            <div id={`m-${i}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {m.text}
            </div>
          </div>
        ))}
        {running && <div style={{ color: '#2b7cd9' }}>● 运行中…</div>}
      </div>
      {selection.text && (
        <div style={{ position: 'fixed', left: selection.x, top: selection.y }}>
          <button onClick={copySelection}>复制所选（REQ-011）</button>
        </div>
      )}
      <SessionControls client={client} sessionId={sessionId} />
      <textarea style={{ ...input, minHeight: 72 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="布置任务…（REQ-005）" />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          style={btn}
          disabled={!draft.trim() || running}
          onClick={async () => {
            const text = draft
            setDraft('')
            setMessages((prev) => [...prev, { role: 'user', text }])
            setRunning(true)
            try {
              await client.prompt({ sessionId, text })
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          发送
        </button>
        <button style={btn} disabled={!running} onClick={() => client.stop({ sessionId }).catch(() => void 0)}>
          停止
        </button>
      </div>
    </main>
  )
}

/** 模型/思考强度与权限预设（REQ-007/008） */
function SessionControls({ client, sessionId }: { client: WhaleClient; sessionId: string }) {
  const [perm, setPerm] = useState<{ options?: Array<{ value: string; name?: string }>; currentValue?: string } | null>(null)
  const [models, setModels] = useState<{ current?: { provider?: string; model?: string } } | null>(null)
  const [sheet, setSheet] = useState<'perm' | 'model' | null>(null)

  useEffect(() => {
    client.permissionGet({ sessionId }).then((r) => setPerm((r as { permissions?: unknown }).permissions as typeof perm)).catch(() => void 0)
    client.models({ sessionId }).then((r) => setModels(r as typeof models)).catch(() => void 0)
  }, [client, sessionId])

  return (
    <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
      <button style={{ ...btn, width: 'auto' }} onClick={() => setSheet('model')}>
        模型{models?.current?.model ? `: ${models.current.model}` : ''}
      </button>
      <button style={{ ...btn, width: 'auto' }} onClick={() => setSheet('perm')}>
        权限{perm?.currentValue ? `: ${perm.currentValue}` : ''}
      </button>
      {sheet === 'model' && (
        <div style={card}>
          <h4>模型与思考强度</h4>
          {/* 精确的 provider 分组目录 TODO：依赖 session.models 结构对齐 */}
          <button onClick={() => setSheet(null)}>关闭</button>
        </div>
      )}
      {sheet === 'perm' && (
        <div style={card}>
          <h4>权限预设</h4>
          {(perm?.options ?? []).map((o) => (
            <div key={o.value} style={{ padding: '6px 0' }} onClick={() => { void client.permissionSet({ sessionId, value: o.value }); setSheet(null) }}>
              {o.name ?? o.value} {perm?.currentValue === o.value ? '✓' : ''}
            </div>
          ))}
          <button onClick={() => setSheet(null)}>关闭</button>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
