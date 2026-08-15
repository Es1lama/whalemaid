// SPEC: docs/security-audit.md#SEC-001/003 信道实测（D-029 肉鸡风险自证）
// 先决条件：中继已起（WHALEMAID_RELAY_LISTEN=127.0.0.1:9180 WHALEMAID_RELAY_DATA=<dir>
//   WHALEMAID_RELAY_RATHOLE_BIN=<rathole 二进制> ADMIN_INSTALL_CODE=e2e-install），rathole 控制端口 2333
// 验证三点：1) noise 隧道经服务端口真实转发通；2) 错误服务端公钥 → 握手失败（pin 生效）；3) /tunnel 必返 serverPublicKey
import { spawn } from 'node:child_process'
import { scryptSync, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'

const RELAY = 'https://127.0.0.1:9180'
const RATHOLE = '/Users/zz/Desktop/ws/Code/programs/dpsk-far/whalemaid/.toolchain/rathole/rathole'
const CFG_DIR = '/Users/zz/Desktop/ws/Code/programs/dpsk-far/whalemaid/.tmp/tunnel-e2e'

const req = (path, opts = {}) => new Promise((resolve, reject) => {
  const r = https.request(RELAY + path, { method: opts.method ?? 'GET', headers: opts.headers ?? {}, rejectUnauthorized: false }, (res) => {
    let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }))
  })
  r.on('error', reject); if (opts.body) r.write(opts.body); r.end()
})

const echo = http.createServer((q, s) => s.end('echo:' + q.url))
await new Promise((r) => echo.listen(6180, '127.0.0.1', r))

const phc = (pw) => {
  const salt = randomBytes(16)
  const dk = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 })
  const b64 = (b) => b.toString('base64').replace(/=+$/, '')
  return `$scrypt$ln=14,r=8,p=1$${b64(salt)}$${b64(dk)}`
}

const DEVICE = 'WHALE-NOISE-0001'
const reg = await req('/_whalemaid/devices', { method: 'POST', headers: { 'content-type': 'application/json', 'x-install-code': 'e2e-install' }, body: JSON.stringify({ deviceId: DEVICE, passwordDigest: await phc('pw-noise-e2e') }) })
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
const proxied = await new Promise((resolve) => {
  http.get(`http://127.0.0.1:${t.port}/hello?via=noise-tunnel`, (res) => {
    let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve(d))
  }).on('error', (e) => resolve('ERR:' + e.message))
})
console.log('through-service-port:', proxied)
if (!proxied.startsWith('echo:')) { console.error('FAIL: noise 隧道不通'); process.exit(1) }

writeFileSync(CFG_DIR + '/bad.toml', renderClient('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='))
const bad = spawn(RATHOLE, [CFG_DIR + '/bad.toml'])
let badOut = ''
bad.stdout.on('data', (d) => badOut += d)
bad.stderr.on('data', (d) => badOut += d)
await new Promise((r) => setTimeout(r, 6000))
bad.kill(); good.kill(); echo.close()
const pinWorks = /noise handshake|handshake|error/i.test(badOut)
console.log('wrong-pubkey:', badOut.split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 220))
console.log(pinWorks ? 'PASS: 隧道通 + 错误公钥握手失败（noise pin 双端生效）' : 'FAIL: 错误公钥未被拒绝')
process.exit(pinWorks ? 0 : 1)
