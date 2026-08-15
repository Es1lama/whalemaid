// SPEC: docs/PREFLIGHT.md 插件形态（apply(ctx) + inject）
// SPEC: docs/PREFLIGHT.md 选项 B：自建 listener，不依赖 DSH 自身绑定
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { CAPABILITIES, type ProviderConfig } from '@whalemaid/contract'
import { Store } from './store.js'
import { PasswordVerifier } from './verifier.js'
import { EventHub } from './events.js'
import { createWhalemaidServer, type HostApiProxy } from './routes.js'
import { createVoiceAdapter } from './providers/voice.js'
import { createVisionAdapter } from './providers/vision.js'
import { RelayClient } from './relay.js'

export const name = 'whalemaid'

export const inject = ['apiProxy', 'credentials']

export { Config } from './config.js'
import type { Config } from './config.js'

/** 配置由 loader 校验后作为第二参数传入（与 dsh 插件惯例一致），默认值在此兜底 */
const DEFAULTS: Config = {
  host: '127.0.0.1',
  port: 3180,
  dataDir: '',
  voiceProvider: '',
  voiceCredentialRef: '',
  voiceModel: '',
  visionProvider: '',
  visionCredentialRef: '',
  visionModel: '',
  relayUrl: '',
  relayInstallCode: '',
  relayFingerprint: '',
  relayPort: 2333,
  ratholeBin: 'rathole',
  allowPlainLan: false,
}

export function apply(ctx: Context, config?: Config): void {
  const resolved = { ...DEFAULTS, ...config }
  const store = new Store(resolved.dataDir)
  const verifier = new PasswordVerifier(store)
  const hub = new EventHub()
  const apiProxy = (ctx as unknown as { apiProxy: HostApiProxy }).apiProxy
  const credentials = (ctx as unknown as {
    credentials: { resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined> }
  }).credentials

  /** BYOK key 解析：dsh-credentials 每操作即时解析（ADR-013），引用名为空时不解析 */
  const keyResolver = async (ref: string): Promise<string | undefined> => {
    if (!ref) return undefined
    const hit = await credentials.resolve(credentialRef(ref))
    return hit?.value
  }

  const voiceCfg: ProviderConfig | undefined = resolved.voiceProvider
    ? { provider: resolved.voiceProvider, credentialRef: resolved.voiceCredentialRef, model: resolved.voiceModel || undefined }
    : undefined
  const visionCfg: ProviderConfig | undefined = resolved.visionProvider
    ? { provider: resolved.visionProvider, credentialRef: resolved.visionCredentialRef, model: resolved.visionModel || undefined }
    : undefined

  const adapters = {
    voice: voiceCfg ? createVoiceAdapter(voiceCfg, () => keyResolver(voiceCfg.credentialRef ?? '')) : undefined,
    vision: visionCfg ? createVisionAdapter(visionCfg, () => keyResolver(visionCfg.credentialRef ?? '')) : undefined,
  }

  const caps = [
    CAPABILITIES.session,
    CAPABILITIES.workspaceCreate,
    CAPABILITIES.directoryBrowse,
    CAPABILITIES.direct,
    ...(adapters.voice ? [CAPABILITIES.voiceByok] : []),
    ...(adapters.vision ? [CAPABILITIES.visionByok] : []),
  ]

  // SEC-005：非回环明文监听默认拒绝（直连必须显式开启 allowPlainLan；默认路径走中继）
  const lanBlocked = resolved.host !== '127.0.0.1' && !resolved.allowPlainLan
  if (lanBlocked) {
    ctx.logger.error(`[whalemaid] 拒绝以明文绑定 ${resolved.host}:${resolved.port}（SEC-005）：非回环监听需显式 allowPlainLan=true，或使用中继（relayUrl）`)
    return
  }

  const server = createWhalemaidServer({ store, verifier, apiProxy, hub, adapters, caps, host: resolved.host, port: resolved.port })

  ctx.logger.info(
    `[whalemaid] 监听 http://${resolved.host}:${resolved.port} （设备 ID 与长期密码见 ${store.file}；语音=${voiceCfg?.provider ?? '未启用'} 视觉=${visionCfg?.provider ?? '未启用'}）`,
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

  // 中继接入（docs/deploy-server.md）：安装码注册（设备编号+密码哈希）→ 隧道 → 凭据心跳
  const relay = resolved.relayUrl
    ? new RelayClient(
        {
          relayUrl: resolved.relayUrl,
          relayInstallCode: resolved.relayInstallCode,
          relayFingerprint: resolved.relayFingerprint,
          ratholeBin: resolved.ratholeBin,
          relayPort: resolved.relayPort,
          pluginPort: resolved.port,
          dataDir: store.file.replace(/store\.json$/, ''),
          deviceId: store.deviceId,
          longPassword: store.longPassword,
          savedCredential: store.relayCredential,
          onCredential: (c) => store.setRelayCredential(c),
        },
        (msg) => ctx.logger.info(msg),
      )
    : null
  if (relay) {
    relay
      .start()
      .then((b) => ctx.logger.info(`[whalemaid] 中继已接入 device=${store.deviceId} port=${b.port}（主控端用设备编号+密码连接，无需 IP）`))
      .catch((e) => ctx.logger.warn(`[whalemaid] 中继接入失败: ${e instanceof Error ? e.message : String(e)}`))
  }

  // 审批桥（REQ-008 原生审批流）：消费 dsh mux 流，转发 approval/requested|resolved 到 SSE
  const muxCtl = new AbortController()
  void (async () => {
    try {
      const mux = (apiProxy as unknown as {
        events?: { mux?: (r: { rpcId: string; payload: Record<string, never> }, signal: AbortSignal) => AsyncIterable<{ rpcId: string; payload: Record<string, unknown> }> }
      }).events?.mux
      if (!mux) {
        ctx.logger.warn('[whalemaid] mux 不可用，审批转发停用')
        return
      }
      for await (const frame of mux({ rpcId: 'whalemaid-mux', payload: {} }, muxCtl.signal)) {
        const f = frame.payload
        if (f.type === 'approval/requested') {
          hub.push('permission-request', {
            sessionId: f.sessionId,
            rpcId: frame.rpcId,
            approvalId: f.approvalId,
            toolName: f.toolName,
            callId: f.callId,
            reason: f.reason,
          })
        } else if (f.type === 'approval/resolved') {
          hub.push('permission-resolved', { sessionId: f.sessionId, approvalId: f.approvalId, outcome: f.outcome })
        } else if (f.type === 'session/event') {
          // 运行态（PROTO-004）：turn/start → running；turn/end → done（真实事件优于猜测）
          const ev = f.event as { type?: string } | undefined
          if (ev?.type === 'turn/start') hub.push('turn-status', { sessionId: f.sessionId, status: 'running' })
          else if (ev?.type === 'turn/end') hub.push('turn-status', { sessionId: f.sessionId, status: 'done' })
        }
      }
    } catch (e) {
      ctx.logger.warn(`[whalemaid] mux 消费中断: ${e instanceof Error ? e.message : String(e)}`)
    }
  })()

  ctx.effect(() => () => {
    muxCtl.abort()
    relay?.stop()
    hub.dispose()
    server.close()
  })
}
