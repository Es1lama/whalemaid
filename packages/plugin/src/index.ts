// SPEC: docs/PREFLIGHT.md 插件形态（apply(ctx) + inject）
// SPEC: docs/protocol.md 受控端插件职责（audit#3 收尾）：自动注册（设备编号+密码哈希）→ rathole noise 隧道直指宿主原生 web 端口；
//       插件不自建任何 listener、不重造任何 RPC——官方 /api+WS+UI 是唯一载体（审批/事件/目录/附件全部由官方通道原生承载）
import type { Context } from '@deepseek-ai/cordis'
import { Store } from './store.js'
import { RelayClient } from './relay.js'
import * as v1 from './v1/routes.js'

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
  voiceProvider: '',
  voiceCredentialRef: '',
  visionProvider: '',
  visionCredentialRef: '',
}

export function apply(ctx: Context, config?: Config): void {
  const resolved = { ...DEFAULTS, ...config }
  const profileBaseUrl = (ctx as unknown as { baseUrl?: string | URL }).baseUrl
  const store = new Store({ dataDir: resolved.dataDir, profileBaseUrl })

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
          onTemporaryStatus: (status) => store.syncTemporaryPasswordStatus(status),
        },
        (msg) => ctx.logger.info(msg),
      )
    : null
  let disposed = false
  ctx.effect(() => () => {
    disposed = true
    relay?.stop()
    store.close()
  })
  if (!relay) {
    ctx.logger.warn('[whalemaid] 未配置 relayUrl：插件不生效（远程控制只走中继，编号+密码模型）——见 docs/deploy-server.md')
    return
  }
  if (!hostWeb?.port) {
    ctx.logger.error('[whalemaid] 宿主无 web 服务（webServer.port 缺失）：本插件依赖官方 web 载体，插件零监听')
    return
  }
  ctx.logger.info(`[whalemaid] 设备编号 ${store.deviceId}（长期密码见 ${store.file}）；隧道目标 = 宿主原生 web:${hostWeb.port}；本地管理 token=${store.adminToken}`)

  // UX-009/022（受控端知情与首次启用引导，控制台级）：
  // 本机（受控端）终端即可看到：设备编号、长期密码位置、轮换入口、被连接提示——无人值守机器的操作者随时可查。
  ctx.logger.info(`[whalemaid] ==== WhaleMaid 受控端说明 ====
  · 设备编号: ${store.deviceId}（主控端用「编号+长期密码」连接，全程无 IP）
  · 长期密码: 见 ${store.file} 的 longPassword；轮换: POST /whalemaid/rotate-password + x-whalemaid-token: ${store.adminToken}
  · 安全: 有人连接本机 = 完整远程控制，等同其坐在本机前；请勿泄露密码，失窃即轮换
  · 被连接提示: 主控端连接成功/断开会打印在下方日志（[whalemaid] 主控端已连接/已断开）
  ========================================`)

  // UX-001：启动即注册——中继暂不可达时指数退避重试（2s→60s，永续），不依赖用户操作
  let attempt = 0
  const tryStart = async () => {
    if (disposed) return
    try {
      await relay.start()
      if (disposed) {
        relay.stop()
        return
      }
      ctx.logger.info(`[whalemaid] 中继已接入 device=${store.deviceId} target=宿主原生web:${hostWeb.port}（主控端用设备编号+密码连接，无需 IP）`)
    } catch (e) {
      if (disposed) return
      attempt += 1
      const delay = Math.min(2000 * 2 ** attempt, 60_000)
      ctx.logger.warn(`[whalemaid] 中继接入失败（第 ${attempt} 次）: ${e instanceof Error ? e.message : String(e)}；${Math.round(delay / 1000)}s 后重试`)
      setTimeout(tryStart, delay).unref()
    }
  }
  void tryStart()

  // REQ-002 密码轮换入口（受控端本机操作，走官方 web 路由机制，插件零监听）：
  // POST /whalemaid/rotate-password + x-whalemaid-token（token 打印在宿主日志）
  try {
    const web = ctx as unknown as {
      webServer?: {
        register?: (route: { kind: 'exact'; path: string; handler: (req: unknown, res: { writeHead: (code: number, headers?: Record<string, string>) => void; end: (body: string) => void }) => void }) => () => void
      }
    }
    web.webServer?.register?.({
      kind: 'exact',
      path: '/whalemaid/rotate-password',
      handler: (_req, res) => {
        const req = _req as { headers: Record<string, string | string[] | undefined>; method?: string }
        const token = req.headers['x-whalemaid-token']
        if (req.method !== 'POST' || token !== store.adminToken) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        const next = store.rotatePassword()
        void relay.rotatePassword(next).catch((e) => ctx.logger.warn(`[whalemaid] 密码轮换失败: ${e instanceof Error ? e.message : String(e)}`))
        ctx.logger.info(`[whalemaid] 长期密码已重生成（新密码见 ${store.file}）`)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, deviceId: store.deviceId }))
      },
    })
  } catch {
    ctx.logger.warn('[whalemaid] 宿主 web 路由不可用，密码轮换入口跳过')
  }

  // PROTO-005/006 V1 语音/视觉 BYOK 路由：仅在配置了 provider 时挂载；
  // 承载 = 官方 webServer.register（与官方路由同源；主控端经隧道同源调用 /api/whalemaid/*）
  // key 只存宿主 dsh-credentials（TM-007/ADR-013）；知情同意由前端 UI 负责（TM-012）
  try {
    const v1Cfg = {
      voiceProvider: resolved.voiceProvider,
      voiceCredentialRef: resolved.voiceCredentialRef,
      visionProvider: resolved.visionProvider,
      visionCredentialRef: resolved.visionCredentialRef,
    }
    if (v1Cfg.voiceProvider || v1Cfg.visionProvider) {
      const web = ctx as unknown as {
        webServer?: {
          register?: (route: {
            kind: 'exact'
            path: string
            handler: (req: { method?: string; headers: Record<string, string | string[] | undefined>; on?: (ev: string, cb: (chunk?: unknown) => void) => void }, res: { writeHead: (code: number, headers?: Record<string, string>) => void; end: (body: string) => void }) => void
          }) => () => void
        }
        get?: (name: string) => unknown
      }
      const credentials = (web as { get?: (name: string) => unknown }).get?.('credentials') as v1.CredentialsService | undefined
      const deps: v1.V1Deps = {
        cfg: v1Cfg,
        credentials,
        log: (m) => ctx.logger.info(m),
      }
      const readBody = (req: { on?: (ev: string, cb: (chunk?: unknown) => void) => void }) => new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on?.('data', (c) => chunks.push(Buffer.from(c as Buffer)))
        req.on?.('end', () => resolve(Buffer.concat(chunks)))
        req.on?.('error', reject)
      })
      const jsonRoute = (path: string, run: (body: Buffer) => Promise<unknown>) => {
        web.webServer?.register?.({
          kind: 'exact',
          path,
          handler: (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405)
              res.end('method not allowed')
              return
            }
            void readBody(req).then(async (body) => {
              try {
                const result = await run(body)
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end(JSON.stringify(result))
              } catch (e) {
                res.writeHead(400, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
              }
            }).catch((e) => {
              res.writeHead(400, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
            })
          },
        })
      }
      if (v1Cfg.voiceProvider) jsonRoute('/api/whalemaid/voice.transcribe', (body) => v1.transcribe(body, deps))
      if (v1Cfg.visionProvider) jsonRoute('/api/whalemaid/vision.describe', (body) => v1.describeImage(body, deps))
      ctx.logger.info(`[whalemaid] V1 增强面已挂载: voice=${v1Cfg.voiceProvider || '-'} vision=${v1Cfg.visionProvider || '-'}（BYOK，key 只存宿主）`)
    }
  } catch (e) {
    ctx.logger.warn(`[whalemaid] V1 路由挂载失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}
