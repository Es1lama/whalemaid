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
import type { Config } from './config.js'

/** 配置由 loader 校验后作为第二参数传入（与 dsh 插件惯例一致），默认值在此兜底 */
const DEFAULTS = { host: '127.0.0.1', port: 3180, dataDir: '' }

export function apply(ctx: Context, config?: Config): void {
  const resolved = { ...DEFAULTS, ...config }
  const store = new Store(resolved.dataDir)
  const verifier = new PasswordVerifier(store)
  const hub = new EventHub()
  const apiProxy = (ctx as unknown as { apiProxy: HostApiProxy }).apiProxy

  const server = createWhalemaidServer({ store, verifier, apiProxy, hub, host: resolved.host, port: resolved.port })

  ctx.logger.info(
    `[whalemaid] 监听 http://${resolved.host}:${resolved.port} （设备 ID 与长期密码见 ${store.file}）`,
  )

  // 宿主事件 → SSE 桥（PROTO-004 帧）：订阅 DSH 会话状态事件，尽力而为（事件名随 rc 变化时静默降级）
  const bridge = (ctx as unknown as { on: (name: string, cb: (...args: unknown[]) => void) => unknown })
  try {
    bridge.on('host/session-status', (sessionId: unknown, status?: unknown) => {
      const s = typeof status === 'object' && status !== null ? (status as { running?: boolean }) : undefined
      hub.push('turn-status', {
        sessionId: String(sessionId),
        status: s?.running ? 'running' : 'done',
      })
    })
  } catch {
    ctx.logger.warn('[whalemaid] SSE 事件桥暂不可用（事件名未在宿主转发列表中）')
  }

  ctx.effect(() => () => {
    hub.dispose()
    server.close()
  })
}
