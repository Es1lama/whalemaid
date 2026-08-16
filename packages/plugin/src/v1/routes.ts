// SPEC: docs/protocol.md#PROTO-005/006 V1 宿主侧路由：语音转录 / 视觉描述（BYOK；key 只存宿主）
// 承载 = 插件经官方 webServer.register 注册路由（与 rotate-password 同机制）——
// 主控端经隧道同源调用 /api/whalemaid/*（前端调用点零改动原则不变：这些是 WhaleMaid 自有增强面）。
import { voiceCall, parseVoiceResponse, visionCall, parseVisionResponse, VOICE_PROVIDERS, VISION_PROVIDERS } from './providers.js'

export interface V1Config {
  voiceProvider: string
  voiceCredentialRef: string
  visionProvider: string
  visionCredentialRef: string
}

/** credentials 服务的最小接口（ctx.get('credentials')；与 llm-pi-ai 用法一致） */
export interface CredentialsService {
  resolve: (ref: string) => Promise<{ value?: string } | undefined>
}

export interface V1Deps {
  cfg: V1Config
  credentials?: CredentialsService
  fetchImpl?: typeof fetch
  log: (msg: string) => void
}

/** 解析 BYOK 凭据：引用名必须命中宿主 dsh-credentials，否则明确报错（不落到环境变量猜测） */
async function resolveKey(ref: string, deps: V1Deps): Promise<string> {
  if (!deps.credentials) throw new Error('宿主无 credentials 服务')
  const hit = await deps.credentials.resolve(ref)
  const value = hit?.value
  if (!value || value.length === 0) throw new Error(`凭据引用 ${ref} 未设置（宿主 dsh-credentials）`)
  return value
}

/** POST /api/whalemaid/voice.transcribe { audio: base64, mimeType } → { text } */
export async function transcribe(body: Buffer, deps: V1Deps): Promise<{ text: string }> {
  const provider = deps.cfg.voiceProvider as 'openai' | 'groq' | 'dashscope'
  if (!VOICE_PROVIDERS.includes(provider)) throw new Error(`voiceProvider 未配置或未知: ${deps.cfg.voiceProvider}`)
  const payload = JSON.parse(body.toString('utf8')) as { audio?: string; mimeType?: string }
  if (!payload.audio) throw new Error('audio(base64) 必填')
  const call = voiceCall({
    provider,
    apiKey: await resolveKey(deps.cfg.voiceCredentialRef, deps),
    audio: Buffer.from(payload.audio, 'base64'),
    mimeType: payload.mimeType ?? 'audio/webm',
  })
  const fetchImpl = deps.fetchImpl ?? fetch
  const res = await fetchImpl(call.url, { method: 'POST', headers: call.headers, body: call.body as unknown as BodyInit })
  const raw = await res.text()
  if (!res.ok) throw new Error(`语音转录上游失败 ${res.status}: ${raw.slice(0, 200)}`)
  return parseVoiceResponse(provider, raw)
}

/** POST /api/whalemaid/vision.describe { image: base64, mimeType } → { description } */
export async function describeImage(body: Buffer, deps: V1Deps): Promise<{ description: string }> {
  const provider = deps.cfg.visionProvider as 'deepseek-ocr' | 'qwen-vl' | 'openai-vision' | 'grok-vision' | 'gemini'
  if (!VISION_PROVIDERS.includes(provider)) throw new Error(`visionProvider 未配置或未知: ${deps.cfg.visionProvider}`)
  const payload = JSON.parse(body.toString('utf8')) as { image?: string; mimeType?: string }
  if (!payload.image) throw new Error('image(base64) 必填')
  const call = visionCall({
    provider,
    apiKey: await resolveKey(deps.cfg.visionCredentialRef, deps),
    image: Buffer.from(payload.image, 'base64'),
    mimeType: payload.mimeType ?? 'image/png',
  })
  const fetchImpl = deps.fetchImpl ?? fetch
  const res = await fetchImpl(call.url, { method: 'POST', headers: call.headers, body: call.body as unknown as BodyInit })
  const raw = await res.text()
  if (!res.ok) throw new Error(`视觉描述上游失败 ${res.status}: ${raw.slice(0, 200)}`)
  return parseVisionResponse(provider, raw)
}
