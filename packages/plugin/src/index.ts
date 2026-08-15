// SPEC: docs/PREFLIGHT.md 插件形态（apply(ctx) + inject）
// SPEC: docs/protocol.md 受控端插件职责（audit#3 收尾）：自动注册（设备编号+密码哈希）→ rathole noise 隧道直指宿主原生 web 端口；
//       插件不自建任何 listener、不重造任何 RPC——官方 /api+WS+UI 是唯一载体（审批/事件/目录/附件全部由官方通道原生承载）
import type { Context } from '@deepseek-ai/cordis'
import { Store } from './store.js'
import { RelayClient } from './relay.js'

export const name = 'whalemaid'

/** webServer = 隧道目标（宿主原生 web 端口）；无 web 服务的宿主（headless）不加载本插件 */
export const inject = ['webServer']

export { Config } from './config.js'
import type { Config } from './config.js'

/** 配置由 loader 校验后作为第二参数传入（与 dsh 插件惯例一致），默认值在此兜底 */
const DEFAULTS: Config = {
  dataDir: '',
  relayUrl: '',
  relayInstallCode: '',
  relayFingerprint: '',
  ratholeBin: 'rathole',
  relayPort: 2333,
}

export function apply(ctx: Context, config?: Config): void {
  const resolved = { ...DEFAULTS, ...config }
  const store = new Store(resolved.dataDir)

  // audit#3（D-022 原生同源透传）：宿主自带的 web 服务就是官方 /api + WS 下联 + 前端 UI 的唯一载体——
  // 隧道 local_addr 直指该端口，受控端不重造任何 RPC（实测：POST /api/session.list 官方信封 200）
  const hostWeb = (ctx as unknown as { webServer?: { port?: number; host?: string } }).webServer

  // 中继接入（docs/deploy-server.md）：安装码注册（设备编号+密码哈希）→ 隧道 → 凭据心跳
  // SEC-001：relayFingerprint 为空 = 拒绝接入（rejectUnauthorized:false 下无指纹等于裸奔）
  if (resolved.relayUrl && !resolved.relayFingerprint) {
    ctx.logger.error('[whalemaid] 配置了 relayUrl 但缺少 relayFingerprint：拒绝接入中继（SEC-001，防中间人）——指纹见服务端启动日志')
  }
  const relay = resolved.relayUrl && resolved.relayFingerprint
    ? new RelayClient(
        {
          relayUrl: resolved.relayUrl,
          relayInstallCode: resolved.relayInstallCode,
          relayFingerprint: resolved.relayFingerprint,
          ratholeBin: resolved.ratholeBin,
          relayPort: resolved.relayPort,
          // 隧道目标 = 宿主原生 web 端口（官方 /api+WS+UI；官方默认 127.0.0.1 安全姿态）
          pluginPort: hostWeb?.port ?? 0,
          dataDir: store.file.replace(/store\.json$/, ''),
          deviceId: store.deviceId,
          longPassword: store.longPassword,
          savedCredential: store.relayCredential,
          onCredential: (c) => store.setRelayCredential(c),
        },
        (msg) => ctx.logger.info(msg),
      )
    : null
  if (!relay) {
    ctx.logger.warn('[whalemaid] 未配置 relayUrl：插件不生效（远程控制只走中继，编号+密码模型）——见 docs/deploy-server.md')
    return
  }
  if (!hostWeb?.port) {
    ctx.logger.error('[whalemaid] 宿主无 web 服务（webServer.port 缺失）：本插件依赖官方 web 载体，不做任何自建监听')
    return
  }
  ctx.logger.info(`[whalemaid] 设备编号 ${store.deviceId}（长期密码见 ${store.file}）；隧道目标 = 宿主原生 web:${hostWeb.port}`)

  // UX-001：启动即注册——中继暂不可达时指数退避重试（2s→60s，永续），不依赖用户操作
  let attempt = 0
  const tryStart = async () => {
    try {
      await relay.start()
      ctx.logger.info(`[whalemaid] 中继已接入 device=${store.deviceId} target=宿主原生web:${hostWeb.port}（主控端用设备编号+密码连接，无需 IP）`)
    } catch (e) {
      attempt += 1
      const delay = Math.min(2000 * 2 ** attempt, 60_000)
      ctx.logger.warn(`[whalemaid] 中继接入失败（第 ${attempt} 次）: ${e instanceof Error ? e.message : String(e)}；${Math.round(delay / 1000)}s 后重试`)
      setTimeout(tryStart, delay).unref()
    }
  }
  void tryStart()

  ctx.effect(() => () => {
    relay.stop()
  })
}
