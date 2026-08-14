// SPEC: docs/protocol.md#PROTO-006 BYOK 视觉适配器（厂商可插拔，ADR-011/035）
// 目标：OCR/简短描述后以文本嵌入 DeepSeek 请求，非原生 MLLM（REQ-022）
// key 经宿主 dsh-credentials 解析（ADR-013）；真实 key 实测见 docs/NEEDED-BY-OWNER.md
import { VISION_PROVIDERS, type ProviderConfig } from '@whalemaid/contract'

export interface VisionAdapter {
  describe(imageBase64: string, mime: string): Promise<string>
}

export type KeyResolver = () => Promise<string | undefined>

function requireKey(key: string | undefined, provider: string): string {
  if (!key) throw new Error(`缺少 ${provider} 凭据：请在宿主 dsh-credentials 配置对应 API key`)
  return key
}

const OCR_PROMPT = '请识别这张图片：先做完整 OCR 转写，再用一两句话描述图片内容。只输出识别结果，不要解释。'

/** OpenAI 兼容 chat（DeepSeek-OCR / 通义 VL / OpenAI / Grok 共用；图以 image_url 内容部件传入） */
function openAiCompatibleVision(baseUrl: string, model: string, label: string, resolveKey: KeyResolver): VisionAdapter {
  return {
    async describe(imageBase64, mime) {
      const key = requireKey(await resolveKey(), label)
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: OCR_PROMPT },
                { type: 'image_url', image_url: { url: `data:${mime ?? 'image/png'};base64,${imageBase64}` } },
              ],
            },
          ],
          max_tokens: 1024,
        }),
      })
      if (!res.ok) throw new Error(`${label} 视觉失败: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
      const content = data.choices?.[0]?.message?.content
      if (typeof content === 'string') return content
      const parts = Array.isArray(content) ? content.map((p) => (typeof p === 'object' && p !== null && 'text' in p ? (p as { text: string }).text : '')).filter(Boolean) : []
      return parts.join('\n')
    },
  }
}

/** Google Gemini generateContent（图以 inline_data 传入） */
function geminiAdapter(model: string, resolveKey: KeyResolver): VisionAdapter {
  return {
    async describe(imageBase64, mime) {
      const key = requireKey(await resolveKey(), 'gemini')
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: OCR_PROMPT },
                { inline_data: { mime_type: mime ?? 'image/png', data: imageBase64 } },
              ],
            },
          ],
        }),
      })
      if (!res.ok) throw new Error(`gemini 视觉失败: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n')
    },
  }
}

export function createVisionAdapter(cfg: ProviderConfig, resolveKey: KeyResolver): VisionAdapter {
  switch (cfg.provider) {
    case VISION_PROVIDERS.deepseekOcr:
      return openAiCompatibleVision(cfg.baseUrl ?? 'https://api.deepseek.com/v1', cfg.model ?? 'deepseek-ocr', 'deepseek-ocr', resolveKey)
    case VISION_PROVIDERS.qwenVl:
      return openAiCompatibleVision(cfg.baseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1', cfg.model ?? 'qwen-vl-max', 'qwen-vl', resolveKey)
    case VISION_PROVIDERS.openai:
      return openAiCompatibleVision(cfg.baseUrl ?? 'https://api.openai.com/v1', cfg.model ?? 'gpt-5.6', 'openai', resolveKey)
    case VISION_PROVIDERS.grok:
      return openAiCompatibleVision(cfg.baseUrl ?? 'https://api.x.ai/v1', cfg.model ?? 'grok-2-vision', 'grok', resolveKey)
    case VISION_PROVIDERS.gemini:
      return geminiAdapter(cfg.model ?? 'gemini-2.5-flash', resolveKey)
    default:
      throw new Error(`视觉厂商未实现: ${cfg.provider}`)
  }
}
