// SPEC: docs/PREFLIGHT.md 独立测试承载：mock apiProxy + 真实网关/凭据/路由，不加载 dsh 运行时（避免触碰 dsh 本体）
// 用法: DSH_HOME=<dir> node lib/standalone.js
import { createWhalemaidServer, type HostApiProxy } from './routes.js'
import { Store } from './store.js'
import { PasswordVerifier } from './verifier.js'
import { EventHub } from './events.js'

/** mock 宿主响应：遵守 dsh-host-apiproxy 纪律（{rpcId, result:{ok,value|error}}） */
const okValue = <T,>(value: T): { rpcId: string; result: { ok: true; value: T } } => ({
  rpcId: 'mock',
  result: { ok: true, value },
})

const mock: HostApiProxy = {
  workspace: {
    create: async () => okValue({ workspaceId: 'ws-mock', created: true }),
  },
  sessions: {
    list: async () => okValue({ items: [] }),
    history: async () => okValue({ events: [] }),
    create: async () => okValue({ sessionId: 'sess-mock' }),
    prompt: async () => okValue({ accepted: true }),
    stop: async () => okValue({ stopped: true }),
    models: async () => okValue({ providers: [] }),
    selectModel: async () => okValue({ selected: {} }),
  },
  host: {
    listDirectory: async () => okValue({ path: '/', entries: [], crumbs: ['/'], truncated: false }),
    createDirectory: async () => okValue({ path: '/x' }),
  },
}

const port = Number(process.env.WHALEMAID_STANDALONE_PORT ?? 3180)
const host = '127.0.0.1'
const store = new Store(process.env.WHALEMAID_STANDALONE_DATA ?? undefined)
const hub = new EventHub()
const server = createWhalemaidServer({ store, verifier: new PasswordVerifier(store), apiProxy: mock, hub, host, port })
console.log(`[whalemaid-standalone] http://${host}:${port} （mock apiProxy；store=${store.file}）`)
process.on('SIGINT', () => {
  hub.dispose()
  server.close()
  process.exit(0)
})
