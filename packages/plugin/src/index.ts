// SPEC: docs/PREFLIGHT.md 插件形态（apply(ctx) + inject）
// SPEC: docs/PREFLIGHT.md 选项 B：自建 listener，不依赖 DSH 自身绑定
import type { Context } from '@deepseek-ai/cordis'
import { Store } from './store.js'
import { PasswordVerifier } from './verifier.js'
import { EventHub } from './events.js'
import { createWhalemaidServer, type HostApiProxy } from './routes.js'

export const name = 'whalemaid'

export const inject = ['apiProxy']

export { Config } from './config.js'

export function apply(ctx: Context) {
  const config = ctx.config as unknown as import('./config.js').Config
  const store = new Store(config.dataDir)
  const verifier = new PasswordVerifier(store)
  const hub = new EventHub()
  const apiProxy = (ctx as unknown as { apiProxy: HostApiProxy }).apiProxy

  const server = createWhalemaidServer({ store, verifier, apiProxy, hub, host: config.host, port: config.port })

  ctx.logger.info(
    `[whalemaid] 监听 http://${config.host}:${config.port} （设备 ID 与长期密码见 ${store.file}）`,
  )

  // 宿主事件 → SSE 桥（TODO: 订阅 DSH host/* 事件映射到 PROTO-004 帧类型，M1 测试 loop 对齐）

  ctx.effect(() => () => {
    hub.dispose()
    server.close()
  })
}
