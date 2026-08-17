import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { createServer } from 'node:https'
import test from 'node:test'
import { assertPinnedWebSocket, peerFingerprint, pinnedHttpsRequest } from './tls-pin.mjs'

const CERT = `-----BEGIN CERTIFICATE-----
MIIBZDCCAQqgAwIBAgIUeOmQGeU0WKUb54T0bWk7NRykx4UwCgYIKoZIzj0EAwIw
ITEfMB0GA1UEAwwWcmNnZW4gc2VsZiBzaWduZWQgY2VydDAgFw03NTAxMDEwMDAw
MDBaGA80MDk2MDEwMTAwMDAwMFowITEfMB0GA1UEAwwWcmNnZW4gc2VsZiBzaWdu
ZWQgY2VydDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABOy/6X+HLqtxslsCi/rm
TZs0/9m71xg5ZARATZEqOBcPagIWRfV/uZ61ilreqzDySLZI31UkBKotJyV/Qu4C
BxujHjAcMBoGA1UdEQQTMBGCD3doYWxlbWFpZC1yZWxheTAKBggqhkjOPQQDAgNI
ADBFAiEAutrveOEoy/ggSeThQBRkQEgbdwChhFRQAa52lLz81iwCIENmtSVAhUHW
3f3CkuFhYmsIlXDZOSyVCcdc1BYsp6ju
-----END CERTIFICATE-----`

const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgsNHmUEuR4AWJyvNj
4Gufq6awNe9UF/1BMbM0ieg+ciChRANCAATsv+l/hy6rcbJbAov65k2bNP/Zu9cY
OWQEQE2RKjgXD2oCFkX1f7metYpa3qsw8ki2SN9VJASqLSclf0LuAgcb
-----END PRIVATE KEY-----`

async function withServer(run) {
  const server = createServer({ cert: CERT, key: KEY }, (_request, response) => {
    response.setHeader('connection', 'close')
    response.end('ok')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    await run(`127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise(resolve => { server.close(resolve) })
  }
}

test('pins every sequential HTTPS request before accepting its response', async () => {
  await withServer(async (server) => {
    let known
    const first = await pinnedHttpsRequest(server, '/', {
      onFirstFingerprint: fingerprint => { known = fingerprint },
    })
    assert.equal(first.body, 'ok')
    assert.equal(known, new X509Certificate(CERT).fingerprint256.replaceAll(':', '').toLowerCase())

    const second = await pinnedHttpsRequest(server, '/', { knownFingerprint: known })
    assert.equal(second.status, 200)
    assert.equal(second.body, 'ok')
  })
})

test('rejects a wrong HTTPS fingerprint', async () => {
  await withServer(async (server) => {
    await assert.rejects(
      pinnedHttpsRequest(server, '/', { knownFingerprint: '00'.repeat(32) }),
      /中继证书指纹变化/,
    )
  })
})

test('empty peer certificates fail closed for HTTPS and WSS', () => {
  const socket = { getPeerCertificate: () => ({ raw: Buffer.alloc(0) }) }
  assert.throws(() => { peerFingerprint(socket) }, /未提供可固定的完整证书/)

  let terminated = 0
  const ws = { _socket: socket, terminate: () => { terminated += 1 } }
  assert.throws(() => { assertPinnedWebSocket('relay.test', ws, 'abc') }, /未提供可固定的完整证书/)
  assert.equal(terminated, 1)
})

test('WSS refuses an unpinned server before reading the peer', () => {
  let terminated = 0
  const ws = { terminate: () => { terminated += 1 } }
  assert.throws(() => { assertPinnedWebSocket('relay.test', ws, undefined) }, /尚未完成首次指纹固定/)
  assert.equal(terminated, 1)
})
