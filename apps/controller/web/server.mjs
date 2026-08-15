// SPEC: docs/native-app-plan.md §4.1/§5 Web 版主控端（Electron/Capacitor 同源复用）
// 模型：浏览器无法开裸 TLS 隧道 → 每个请求经 WSS 隧道入口（SEC-004b web 变体）逐连接取 grant 转发。
// 设备管理首屏（ToDesk 式：服务端地址+设备编号+密码，无 IP/端口/协议字样）+ 连接后反向代理宿主官方 UI/API/WS。
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import WebSocket, { WebSocketServer } from 'ws'

const PORT = Number(process.env.CONTROLLER_PORT ?? 3210)
const HOST_AUTHORITY = process.env.CONTROLLER_HOST_AUTHORITY ?? '127.0.0.1:3181' // 受控端宿主 web 权威（过官方信任栅栏用）

/** 会话内存：已连接设备 + 密码（仅进程内存，不落盘；grant 单次消费故每次代理都要重签） */
const session = { server: '', deviceId: '', password: '' }

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}

/** 中继证书指纹表（按服务端地址分别 TOFU，SEC-001 同模型）；落盘持久化，重启后仍固定（审计三轮#1） */
const DATA_DIR = process.env.CONTROLLER_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '.controller-data')
const FP_FILE = join(DATA_DIR, 'fingerprints.json')
mkdirSync(DATA_DIR, { recursive: true })
const serverFingerprints = new Map(Object.entries(existsSync(FP_FILE) ? JSON.parse(readFileSync(FP_FILE, 'utf8')) : {}))
function persistFingerprints() {
  writeFileSync(FP_FILE, JSON.stringify(Object.fromEntries(serverFingerprints), null, 2), { mode: 0o600 })
}
/** WSS 证书校验（审计三轮#1）：握手完成后必须与控制面指纹一致，否则断连——WSS 与 HTTPS 同身份链 */
function assertWssFingerprint(server, ws) {
  const cert = ws._socket?.getPeerCertificate?.(true)
  const fp = cert?.raw ? createHash('sha256').update(cert.raw).digest('hex') : ''
  const known = serverFingerprints.get(server)
  if (!known) { ws.terminate(); throw new Error('该服务端尚未完成首次指纹固定（先经控制面 HTTPS 建立信任）') }
  if (fp !== known) { ws.terminate(); throw new Error(`WSS 证书指纹与控制面不一致（防中间人）：${fp.slice(0, 12)}… ≠ ${known.slice(0, 12)}…`) }
}

/** 调中继控制面（TLS + 证书指纹固定；任何异常都走 reject，绝不抛进程级错误） */
function relayRequest(server, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const r = https.request(`https://${server}${path}`, { method: opts.method ?? 'GET', headers: opts.headers ?? {}, rejectUnauthorized: false }, (res) => {
      let d = ''
      res.on('data', (c) => d += c)
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    })
    r.on('socket', (socket) => {
      socket.on('error', (e) => { try { r.destroy() } catch {} reject(e) })
      socket.on('secureConnect', () => {
        try {
          const cert = socket.getPeerCertificate(true)
          const fp = createHash('sha256').update(cert.raw ?? Buffer.alloc(0)).digest('hex')
          const known = serverFingerprints.get(server)
          if (known && fp !== known) {
            r.destroy()
            reject(new Error(`中继证书指纹变化（防中间人）：预期 ${known.slice(0, 12)}… 实际 ${fp.slice(0, 12)}…`))
          } else if (!known) {
            serverFingerprints.set(server, fp) // 首次 TOFU（落盘，重启后继续生效）
            persistFingerprints()
          }
        } catch (e) { r.destroy(); reject(e) }
      })
    })
    r.on('error', reject)
    if (opts.body) r.write(opts.body)
    r.end()
  })
}

/** 一次隧道代理：/connect 签 grant → WSS GRANT → 转发字节 → 回收响应（grant 单次消费，逐请求签名） */
function tunnelExchange(httpText, binaryFrames = []) {
  return new Promise((resolve, reject) => {
    relayRequest(session.server, '/_whalemaid/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: session.deviceId, password: session.password }),
    }).then((c) => {
      if (c.status !== 200) return reject(new Error(`connect ${c.status}: ${c.body}`))
      const grant = JSON.parse(c.body).grant
      const ws = new WebSocket(`wss://${session.server}/_whalemaid/tunnel-ws`, { rejectUnauthorized: false })
      const out = []
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('隧道超时')) }, 15_000)
      ws.on('open', () => {
        try { assertWssFingerprint(session.server, ws) } catch (e) { clearTimeout(timer); return reject(e) }
        ws.send(`GRANT ${grant} ${session.deviceId}`)
        ws.send(httpText)
        for (const f of binaryFrames) ws.send(f)
      })
      ws.on('message', (d) => out.push(Buffer.from(d)))
      ws.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(out)) })
      ws.on('error', (e) => { clearTimeout(timer); reject(e) })
    }).catch(reject)
  })
}

/** 浏览器请求 → 隧道内 HTTP 请求（Host/Origin 改写为宿主权威，过官方信任栅栏） */
function browserRequestToTunnel(req, bodyBuf) {
  const target = req.url.split('?')[0]
  const headers = Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length', 'origin'].includes(k))
  const lines = [`${req.method} ${req.url} HTTP/1.1`]
  lines.push(`Host: ${HOST_AUTHORITY}`)
  lines.push(`Origin: http://${HOST_AUTHORITY}`)
  for (const [k, v] of headers) lines.push(`${k}: ${v}`)
  if (bodyBuf?.length) lines.push(`content-length: ${bodyBuf.length}`)
  lines.push('Connection: close', '', '')
  return { httpText: lines.join('\r\n'), bodyBuf }
}

function serveControllerPage(res) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhaleMaid 主控端</title><style>
body{font-family:system-ui,-apple-system,'PingFang SC',sans-serif;background:#0f1115;color:#e6e8eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{width:min(92vw,380px);background:#181b21;border:1px solid #262a33;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 4px} .sub{color:#8b93a1;font-size:13px;margin:0 0 20px}
label{display:block;font-size:13px;color:#9aa3b2;margin:14px 0 6px}
input{width:100%;box-sizing:border-box;background:#0f1115;border:1px solid #2c313d;color:#e6e8eb;border-radius:8px;padding:11px 12px;font-size:15px}
input:focus{outline:none;border-color:#4c7dff}
button{width:100%;margin-top:22px;background:#4c7dff;border:0;color:#fff;border-radius:8px;padding:12px;font-size:15px;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}
#status{margin-top:14px;font-size:13px;color:#8b93a1;min-height:18px}
.err{color:#ff6b6b}
</style></head><body><div class="card"><h1>WhaleMaid</h1><p class="sub">远程控制 · 设备编号 + 密码（无 IP）</p>
<label>服务端地址（仅首次）</label><input id="server" placeholder="relay.example.com" autocomplete="off">
<label>设备编号</label><input id="device" placeholder="WHALE-XXXX-XXXX" autocomplete="off" autocapitalize="characters">
<label>设备密码</label><input id="pw" type="password" placeholder="长期密码" autocomplete="off">
<button id="go">连接</button><div id="status"></div></div>
<script>
const $ = (id) => document.getElementById(id)
const saved = JSON.parse(localStorage.getItem('whalemaid-controller') ?? '{}')
$('server').value = saved.server ?? ''
$('device').value = saved.device ?? ''
$('go').onclick = async () => {
  const st = $('status'); st.className = ''; st.textContent = '正在连接…'; $('go').disabled = true
  try {
    const res = await fetch('/_ctrl/connect', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: $('server').value, deviceId: $('device').value.toUpperCase(), password: $('pw').value }) })
    const data = await res.json()
    if (!res.ok) { st.className = 'err'; st.textContent = data.error ?? ('失败 ' + res.status); $('go').disabled = false; return }
    localStorage.setItem('whalemaid-controller', JSON.stringify({ server: $('server').value, device: $('device').value.toUpperCase() }))
    st.textContent = '已连接，正在载入官方界面…'
    location.href = '/'
  } catch (e) { st.className = 'err'; st.textContent = String(e); $('go').disabled = false }
}
</script></body></html>`
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
}

/** 解码 HTTP/1.1 chunked 响应体（隧道上游常用） */
function decodeChunked(buf) {
  const out = []
  let i = 0
  while (i < buf.length) {
    const lineEnd = buf.indexOf('\r\n', i)
    if (lineEnd < 0) break
    const size = parseInt(buf.slice(i, lineEnd).toString(), 16)
    if (!size) break
    out.push(buf.slice(lineEnd + 2, lineEnd + 2 + size))
    i = lineEnd + 2 + size + 2
  }
  return Buffer.concat(out)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')

  // 设备管理：连接接口（审计三轮#5：只接受本机控制器页面发起的请求，防恶意网页 CSRF）
  if (url.pathname === '/_ctrl/connect' && req.method === 'POST') {
    const host = (req.headers.host ?? '').split(':')[0]
    const origin = req.headers.origin
    if (!['127.0.0.1', 'localhost'].includes(host)) return json(res, 403, { error: 'forbidden origin' })
    if (origin && !origin.startsWith(`http://${req.headers.host}`)) return json(res, 403, { error: 'forbidden origin' })
    let body = ''
    req.on('data', (c) => body += c)
    req.on('end', async () => {
      try {
        const { server: srv, deviceId, password } = JSON.parse(body)
        if (!srv || !deviceId || !password) return json(res, 400, { error: 'server/deviceId/password 必填' })
        session.server = srv.replace(/^https?:\/\//, '').replace(/\/$/, '')
        session.deviceId = deviceId
        session.password = password
        const probe = await relayRequest(session.server, `/_whalemaid/devices/${deviceId}/status`)
        if (probe.status !== 200) return json(res, 502, { error: '服务端不可达: ' + probe.status })
        const st = JSON.parse(probe.body)
        if (!st.registered) return json(res, 404, { error: '设备编号不存在' })
        if (!st.online) return json(res, 503, { error: '设备不在线（受控端未开启或已离线）' })
        // 预验证密码（防把错误密码带进 UI 流程）
        const auth = await relayRequest(session.server, '/_whalemaid/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, password }) })
        if (auth.status !== 200) return json(res, 401, { error: '密码错误' })
        json(res, 200, { ok: true })
      } catch (e) { json(res, 502, { error: String(e) }) }
    })
    return
  }

  // 未连接：只给设备管理页
  if (!session.deviceId) return serveControllerPage(res)

  // 反向代理：宿主官方 UI/静态/API 全部经隧道
  try {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      try {
        const bodyBuf = Buffer.concat(chunks)
        const { httpText } = browserRequestToTunnel(req, bodyBuf)
        // body 以二进制帧随 HTTP 头文本之后发送（避免文本编码损坏二进制负载）
        const raw = await tunnelExchange(httpText, bodyBuf.length ? [bodyBuf] : [])
        const sep = raw.indexOf('\r\n\r\n')
        if (sep < 0) return json(res, 502, { error: '隧道响应异常' })
        const head = raw.slice(0, sep).toString()
        let payload = raw.slice(sep + 4)
        const status = Number((head.match(/HTTP\/1\.1 (\d+)/) ?? [])[1] ?? 502)
        const resHeaders = Object.fromEntries(
          head.split('\r\n').slice(1).map((l) => { const i = l.indexOf(':'); return i < 0 ? null : [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()] }).filter(Boolean),
        )
        if (resHeaders['transfer-encoding'] === 'chunked') {
          payload = decodeChunked(payload)
        }
        delete resHeaders['transfer-encoding']
        delete resHeaders.connection
        delete resHeaders['content-length']
        res.writeHead(status, { ...resHeaders, 'content-length': payload.length })
        res.end(payload)
      } catch (e) { json(res, 502, { error: String(e) }) }
    })
    return
  } catch (e) { return json(res, 500, { error: String(e) }) }
})

// 官方 WS 事件下联（/api/events.mux|host）：浏览器 upgrade → 隧道 ws 双工桥（逐连接 grant）
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x')
  if (!url.pathname.startsWith('/api/events') || !session.deviceId) { socket.destroy(); return }
  const tunnel = async () => {
    const c = await relayRequest(session.server, '/_whalemaid/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: session.deviceId, password: session.password }) })
    if (c.status !== 200) { socket.destroy(); return }
    const grant = JSON.parse(c.body).grant
    const up = new WebSocket(`wss://${session.server}/_whalemaid/tunnel-ws`, { rejectUnauthorized: false })
    up.on('open', () => {
      try { assertWssFingerprint(session.server, up) } catch (e) { up.terminate(); socket.destroy(); return }
      up.send(`GRANT ${grant} ${session.deviceId}`)
      // 浏览器升级请求以原始 HTTP 请求形式打进隧道（官方连接插件读 upgrade 头）
      const lines = [`${req.method} ${req.url} HTTP/1.1`, `Host: ${HOST_AUTHORITY}`, 'Connection: Upgrade', 'Upgrade: websocket', ...(req.headers['sec-websocket-key'] ? [`Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}`] : []), 'Sec-WebSocket-Version: 13', '', '']
      up.send(lines.join('\r\n'))
    })
    up.on('message', (d) => { if (socket.writable) socket.write(d) })
    up.on('close', () => socket.destroy())
    up.on('error', () => socket.destroy())
    socket.on('data', (d) => { if (up.readyState === WebSocket.OPEN) up.send(d) })
    socket.on('close', () => up.close())
  }
  tunnel().catch((e) => { console.error('[whalemaid-controller] events 桥失败:', String(e)); socket.destroy() })
})

server.listen(PORT, '127.0.0.1', () => console.log(`[whalemaid-controller] http://127.0.0.1:${PORT}（Web 版主控端；服务端地址只在首次配置页出现，全程无 IP/端口字样）`))
