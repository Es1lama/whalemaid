import { createHash } from 'node:crypto'
import https from 'node:https'

/** A controller TLS connection never reuses sockets or resumable certificate state. */
export function freshTlsAgent() {
  return new https.Agent({ keepAlive: false, maxCachedSessions: 0 })
}

/** Return the peer certificate fingerprint, rejecting an empty resumed-session certificate. */
export function peerFingerprint(socket) {
  const raw = socket?.getPeerCertificate?.(true)?.raw
  if (!raw?.length) throw new Error('中继未提供可固定的完整证书，拒绝连接（SEC-001 防中间人）')
  return createHash('sha256').update(raw).digest('hex')
}

/** Compare an established WebSocket TLS peer with the HTTPS control-plane identity. */
export function assertPinnedWebSocket(server, ws, knownFingerprint) {
  if (!knownFingerprint) {
    ws.terminate()
    throw new Error('该服务端尚未完成首次指纹固定（先经控制面 HTTPS 建立信任）')
  }
  let actual
  try {
    actual = peerFingerprint(ws._socket)
  } catch (error) {
    ws.terminate()
    throw error
  }
  if (actual !== knownFingerprint) {
    ws.terminate()
    throw new Error(`WSS 证书指纹与控制面不一致（防中间人）：${actual.slice(0, 12)}… ≠ ${knownFingerprint.slice(0, 12)}…`)
  }
}

/** HTTPS request whose response is accepted only after a non-empty certificate pin check. */
export function pinnedHttpsRequest(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const agent = freshTlsAgent()
    let verified = false
    let settled = false
    const request = https.request(`https://${server}${path}`, {
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      rejectUnauthorized: false,
      agent,
    }, (response) => {
      if (!verified) {
        response.destroy()
        fail(new Error('无法验证中继证书，拒绝连接（SEC-001 防中间人）'))
        return
      }
      const chunks = []
      response.on('data', chunk => { chunks.push(chunk) })
      response.on('error', fail)
      response.on('end', () => {
        if (settled) return
        settled = true
        agent.destroy()
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    const fail = (error) => {
      if (settled) return
      settled = true
      agent.destroy()
      request.destroy()
      reject(error)
    }
    request.on('socket', (socket) => {
      socket.once('secureConnect', () => {
        try {
          const actual = peerFingerprint(socket)
          const known = options.knownFingerprint
          if (known && actual !== known) {
            fail(new Error(`中继证书指纹变化（防中间人）：预期 ${known.slice(0, 12)}… 实际 ${actual.slice(0, 12)}…`))
            return
          }
          if (!known) options.onFirstFingerprint?.(actual)
          verified = true
        } catch (error) {
          fail(error)
        }
      })
    })
    request.on('error', fail)
    if (options.body) request.write(options.body)
    request.end()
  })
}
