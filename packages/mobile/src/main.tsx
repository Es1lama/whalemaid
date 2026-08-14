// SPEC: docs/requirements.md#REQ-001..011 移动端业务视图（骨架：登录 → 会话列表 → 聊天）
// TODO(M1): 目录模式(REQ-010)/引用复制(REQ-011)/工作区创建 UI(REQ-009) 逐项补齐
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEVICE_ID_PATTERN } from '@whalemaid/contract'
import { WhaleClient } from './api/client.js'
import { exportPublicJwk, getOrCreateKeypair, signNonce } from './crypto/device-key.js'

type View = 'login' | 'home'

function App() {
  const [view, setView] = useState<View>('login')
  const [base, setBase] = useState(() => localStorage.getItem('whalemaid.base') ?? '')
  const [deviceId, setDeviceId] = useState(() => localStorage.getItem('whalemaid.deviceId') ?? '')
  const [client, setClient] = useState<WhaleClient | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('whalemaid.token')
    if (base && token) {
      const c = new WhaleClient(base)
      c.setToken(token)
      setClient(c)
      setView('home')
    }
  }, [base])

  async function connect(password: string) {
    setError('')
    if (!DEVICE_ID_PATTERN.test(deviceId)) return setError('设备 ID 格式应为 WHALE-XXXX-XXXX')
    const c = new WhaleClient(base.replace(/\/$/, ''))
    try {
      const pair = await getOrCreateKeypair()
      const jwk = await exportPublicJwk(pair)
      const { nonce } = await c.handshake({ deviceId, publicKeyJwk: jwk })
      const sig = await signNonce(pair, nonce)
      const { deviceToken } = await c.bind({ deviceId, nonce, password, nonceSignature: sig })
      c.setToken(deviceToken)
      localStorage.setItem('whalemaid.base', c['base'])
      localStorage.setItem('whalemaid.deviceId', deviceId)
      localStorage.setItem('whalemaid.token', deviceToken)
      setClient(c)
      setView('home')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return view === 'login' || !client ? (
    <LoginView base={base} setBase={setBase} deviceId={deviceId} setDeviceId={setDeviceId} error={error} onConnect={connect} />
  ) : (
    <HomeView client={client} />
  )
}

function LoginView(props: {
  base: string
  setBase: (v: string) => void
  deviceId: string
  setDeviceId: (v: string) => void
  error: string
  onConnect: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  return (
    <main style={{ padding: 16 }}>
      <h1>🐳 WhaleMaid</h1>
      <p>主机地址（直连 http://IP:端口，或中继地址）</p>
      <input value={props.base} onChange={(e) => props.setBase(e.target.value)} placeholder="http://192.168.1.10:3180" />
      <input value={props.deviceId} onChange={(e) => props.setDeviceId(e.target.value)} placeholder="设备 ID：WHALE-XXXX-XXXX" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="长期密码" />
      {props.error && <p style={{ color: 'red' }}>{props.error}</p>}
      <button onClick={() => props.onConnect(password)}>连接</button>
    </main>
  )
}

function HomeView({ client }: { client: WhaleClient }) {
  const [sessions, setSessions] = useState<unknown>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    client.sessionList().then((d) => mounted.current && setSessions(d))
    return () => {
      mounted.current = false
    }
  }, [client])

  return (
    <main style={{ padding: 16 }}>
      <h1>🐳 会话</h1>
      <pre style={{ fontSize: 12 }}>{JSON.stringify(sessions, null, 2).slice(0, 500)}</pre>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="布置任务…（REQ-005 原生会话）" />
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await client.prompt({ sessionId: '', text: prompt })
            setPrompt('')
          } finally {
            setBusy(false)
          }
        }}
      >
        发送
      </button>
      <p style={{ color: '#888', fontSize: 12 }}>骨架版：会话选择/聊天流/模型/权限/停止/工作区创建将在 M1 测试 loop 补齐</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
