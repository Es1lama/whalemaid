// SPEC: docs/protocol.md#PROTO-005 BYOK 语音适配器（厂商可插拔，ADR-009）
// key 经宿主 dsh-credentials 解析（ADR-013）；真实 key 实测见 docs/NEEDED-BY-OWNER.md
import { VOICE_PROVIDERS, type ProviderConfig } from '@whalemaid/contract'

export interface VoiceAdapter {
  transcribe(audio: Buffer, format: string): Promise<string>
}

/** audit#7：dashscope 路径未经真实 key 验收——不对外广播能力位，配置了也只对 OpenAI 兼容系生效 */
export function voiceProviderVerified(provider: string): boolean {
  return provider !== VOICE_PROVIDERS.dashscope
}

export type KeyResolver = () => Promise<string | undefined>

function requireKey(key: string | undefined, provider: string): string {
  if (!key) throw new Error(`缺少 ${provider} 凭据：请在宿主 dsh-credentials 配置对应 API key`)
  return key
}

/** OpenAI 系 multipart 转写（OpenAI / Groq 接口兼容） */
function openAiCompatible(baseUrl: string, model: string, label: string, resolveKey: KeyResolver): VoiceAdapter {
  return {
    async transcribe(audio, format) {
      const key = requireKey(await resolveKey(), label)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(audio)]), `audio.${format === 'pcm' ? 'wav' : format}`)
      form.append('model', model)
      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: form,
      })
      if (!res.ok) throw new Error(`${label} 转写失败: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as { text?: string }
      return data.text ?? ''
    },
  }
}

/** DashScope Paraformer-v2 录音文件识别（异步提交 + 轮询；需公网可达 file_urls，BYOK 用户可自配 OSS） */
function dashscopeAdapter(model: string, resolveKey: KeyResolver): VoiceAdapter {
  return {
    async transcribe(_audio, _format) {
      // TODO(REQ-020): 录音文件识别需 file_urls；骨架保留异步接口形状，真实 key 实测（NEEDED-BY-OWNER 第 1 项）
      void resolveKey
      throw new Error(`dashscope(${model}) 录音文件识别待真实 key 实测（需可访问的文件 URL）`)
    },
  }
}

export function createVoiceAdapter(cfg: ProviderConfig, resolveKey: KeyResolver): VoiceAdapter {
  switch (cfg.provider) {
    case VOICE_PROVIDERS.openai:
      return openAiCompatible(cfg.baseUrl ?? 'https://api.openai.com/v1', cfg.model ?? 'whisper-1', 'openai', resolveKey)
    case VOICE_PROVIDERS.groq:
      return openAiCompatible(cfg.baseUrl ?? 'https://api.groq.com/openai/v1', cfg.model ?? 'whisper-large-v3', 'groq', resolveKey)
    case VOICE_PROVIDERS.dashscope:
      return dashscopeAdapter(cfg.model ?? 'paraformer-v2', resolveKey)
    case VOICE_PROVIDERS.iflytek:
    default:
      throw new Error(`语音厂商未实现: ${cfg.provider}`)
  }
}
