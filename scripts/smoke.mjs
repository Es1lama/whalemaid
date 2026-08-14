#!/usr/bin/env node
// SPEC: docs/requirements.md 接口级冒烟测试（REQ-001/002/005；REQ-009 由 WHALEMAID_SMOKE_WORKSPACE=1 显式开启）
// 用法: WHALEMAID_BASE=http://127.0.0.1:3180 WHALEMAID_DEVICE=WHALE-ABCD-EFGH node scripts/smoke.mjs
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.WHALEMAID_BASE ?? 'http://127.0.0.1:3180').replace(/\/$/, '')
const DEVICE_ID = process.env.WHALEMAID_DEVICE ?? 'WHALE-ABCD-EFGH'
const ID_PATTERN = /^WHALE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

if (!ID_PATTERN.test(DEVICE_ID)) {
  console.error('设备 ID 非法：', DEVICE_ID)
  process.exit(1)
}

// 长期密码：测试专用，读宿主 store.json（生产由插件设置页展示）；store 随 DSH_HOME 走
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const store = JSON.parse(readFileSync(join(dshHome, 'whalemaid', 'store.json'), 'utf8'))
const PASSWORD = process.env.WHALEMAID_PASSWORD ?? store.longPassword

async function call(method, payload, token) {
  const res = await fetch(`${BASE}/api/v1?method=${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ v: 1, rpcId: crypto.randomUUID(), method, payload }),
  })
  return res.json()
}

function assert(cond, label) {
  if (!cond) {
    console.error('✗', label)
    process.exitCode = 1
    return false
  }
  console.log('✓', label)
  return true
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)

// 1. 握手
const hs = await call('device.handshake', { deviceId: DEVICE_ID, publicKeyJwk: jwk })
assert(hs.ok && typeof hs.data.nonce === 'string', 'handshake 返回 nonce 与 caps')

// 2. 挑战应答绑定
const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(hs.data.nonce))
const sigB64 = Buffer.from(sig).toString('base64')
const bind = await call('device.bind', { deviceId: DEVICE_ID, nonce: hs.data.nonce, password: PASSWORD, nonceSignature: sigB64 })
assert(bind.ok && typeof bind.data.deviceToken === 'string', 'bind 签发 deviceToken')
const token = bind.data?.deviceToken

// 3. 无 token 应被拒（TM-005 网关）
const noAuth = await call('session.list', {})
assert(!noAuth.ok && noAuth.error.code === 'auth-failed', '无 token 被网关拒绝')

// 4. 带 token 会话列表（REQ-005 原生会话）
const list = await call('session.list', {}, token)
assert(list.ok, 'session.list 透传成功')

// 5. 坏密码应被拒（TM-004/009）
const bad = await call('device.bind', { deviceId: DEVICE_ID, nonce: 'xxxx', password: 'wrong-password', nonceSignature: sigB64 })
assert(!bad.ok, '错误凭据被拒绝')

// 6. 目录浏览（browse seam 透传）
const dir = await call('host.listDirectory', {}, token)
assert(dir.ok || dir.error?.code === 'directory-unreadable', 'host.listDirectory 可调用（或返回目录错误码）')

// 7. 全盘浏览默认拒绝（ADR-008 范围策略）
const full = await call('host.listDirectory', { scope: 'full' }, token)
assert(!full.ok && full.error.code === 'scope-denied', '全盘浏览被范围策略拒绝')

// 8.（可选）工作区创建——会写真实注册表，默认关闭
if (process.env.WHALEMAID_SMOKE_WORKSPACE === '1') {
  const ws = await call('workspace.create', { path: process.env.WHALEMAID_SMOKE_WORKSPACE_PATH }, token)
  assert(ws.ok, 'workspace.create 成功')
}

console.log(process.exitCode ? '\n冒烟测试存在失败项' : '\n冒烟测试全部通过')
