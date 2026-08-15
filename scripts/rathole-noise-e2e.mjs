// SPEC: docs/security-audit.md#SEC-001/003/004b 信道全链实测（D-029 肉鸡风险自证）
// 先决条件：中继已起（WHALEMAID_RELAY_LISTEN=127.0.0.1:9180 WHALEMAID_RELAY_DATA=<dir>
//   WHALEMAID_RELAY_RATHOLE_BIN=<rathole 二进制> ADMIN_INSTALL_CODE=e2e-install），rathole 控制端口 2333
// 验证五点：1) noise 隧道建立；2) /connect 签发一次性 grant（响应不含设备服务端口）；3) grant 经 TLS 隧道入口转发通；
// 4) grant 重用失败；5) 伪造 grant 失败；6) 错误 noise 公钥握手失败（pin 生效）
import { spawn } from 'node:child_process'
import { scryptSync, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'

const RELAY = 'https://127.0.0.1:9180'
const RATHOLE = '/Users/zz/Desktop/ws/Code/programs/dpsk-far/whalemaid/.toolchain/rathole/rathole'
const CFG_DIR = '/Users/zz/Desktop/ws/Code/programs/dpsk-far/whalemaid/.tmp/tunnel-e2e'

const req = (path, opts = {}) => new Promise((resolve, reject) => {
  const r = https.request(RELAY + path, { method: opts.method ?? 'GET', headers: opts.headers ?? {}, rejectUnauthorized: false }, (res) => {
    let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }))
  })
  r.on('error', reject); if (opts.body) r.write(opts.body); r.end()
})

/** TLS 隧道入口：发 GRANT 行后把 HTTP 请求当字节流打过去，读回响应 */
const viaTunnel = (grant, deviceId, httpText) => new Promise((resolve) => {
  const sock = tls.connect({ host: '127.0.0.1', port: 9443, rejectUnauthorized: false }, () => {
    sock.write(`GRANT ${grant} ${deviceId}\n${httpText}`)
  })
  let data = ''
  let closed = false
  sock.on('data', (d) => data += d)
  sock.on('close', () => { closed = true; resolve(data) })
  sock.on('error', () => { if (!closed) resolve('CLOSED/ERR') })
  setTimeout(() => { sock.destroy(); if (!closed) resolve(data + '|TIMEOUT') }, 5000)
})

const echo = http.createServer((q, s) => s.end('echo:' + q.url))
await new Promise((r) => echo.listen(6180, '127.0.0.1', r))

const phc = (pw) => {
  const salt = randomBytes(16)
  const dk = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 })
  const b64 = (b) => b.toString('base64').replace(/=+$/, '')
  return `$scrypt$ln=14,r=8,p=1$${b64(salt)}$${b64(dk)}`
}

const DEVICE = 'WHALE-GRANT-0001'
const reg = await req('/_whalemaid/devices', { method: 'POST', headers: { 'content-type': 'application/json', 'x-install-code': 'e2e-install' }, body: JSON.stringify({ deviceId: DEVICE, passwordDigest: await phc('pw-grant-e2e') }) })
const regJson = JSON.parse(reg.body)
const tun = await req(`/_whalemaid/devices/${DEVICE}/tunnel`, { method: 'POST', headers: { authorization: `Bearer ${regJson.credential}` } })
const t = JSON.parse(tun.body)
if (!t.serverPublicKey) { console.error('FAIL: /tunnel 未返回 serverPublicKey'); process.exit(1) }

const renderClient = (pubkey) => [
  '[client]', 'remote_addr = "127.0.0.1:2333"', '',
  '[client.transport]', 'type = "noise"', '[client.transport.noise]', `remote_public_key = "${pubkey}"`, '',
  `[client.services.${t.service}]`, `token = "${t.tunnelToken}"`, 'local_addr = "127.0.0.1:6180"', '',
].join('\n')

mkdirSync(CFG_DIR, { recursive: true })
writeFileSync(CFG_DIR + '/good.toml', renderClient(t.serverPublicKey))
const good = spawn(RATHOLE, [CFG_DIR + '/good.toml'])
await new Promise((r) => setTimeout(r, 2500))

// /connect → grant（SEC-004b）
const con = await req('/_whalemaid/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: DEVICE, password: 'pw-grant-e2e' }) })
console.log('connect:', con.status, con.body)
const c = JSON.parse(con.body)
if (con.status !== 200 || !c.grant) { console.error('FAIL: /connect 未签发 grant'); process.exit(1) }
if ('port' in c) { console.error('FAIL: /connect 泄露设备服务端口'); process.exit(1) }

const httpGet = `GET /hello?via=grant-tunnel HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`
const out = await viaTunnel(c.grant, DEVICE, httpGet)
console.log('grant-tunnel:', out.split('\r\n').pop() || out.slice(0, 80))
if (!out.includes('echo:/hello?via=grant-tunnel')) { console.error('FAIL: grant 隧道不通'); process.exit(1) }

// 攻击路径：grant 重用 → 拒绝
const reuse = await viaTunnel(c.grant, DEVICE, httpGet)
console.log('grant-reuse:', reuse.includes('echo:') ? 'FAIL(重用成功!)' : 'PASS(拒绝)')
if (reuse.includes('echo:')) process.exit(1)

// 攻击路径：伪造 grant → 拒绝
const forge = await viaTunnel('0'.repeat(32), DEVICE, httpGet)
console.log('grant-forge:', forge.includes('echo:') ? 'FAIL(伪造成功!)' : 'PASS(拒绝)')
if (forge.includes('echo:')) process.exit(1)

// 攻击路径：错误 noise 公钥 → 握手失败（pin 生效）
writeFileSync(CFG_DIR + '/bad.toml', renderClient('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='))
const bad = spawn(RATHOLE, [CFG_DIR + '/bad.toml'])
let badOut = ''
bad.stdout.on('data', (d) => badOut += d)
bad.stderr.on('data', (d) => badOut += d)
await new Promise((r) => setTimeout(r, 6000))
bad.kill(); good.kill(); echo.close()
console.log('wrong-pubkey:', badOut.split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 160))
console.log(/noise handshake|handshake|error/i.test(badOut) ? 'PASS: 全链安全（noise+grant+TLS）' : 'FAIL: 错误公钥未被拒绝')
process.exit(/noise handshake|handshake|error/i.test(badOut) ? 0 : 1)
