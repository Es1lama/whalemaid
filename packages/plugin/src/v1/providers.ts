// SPEC: docs/protocol.md#PROTO-005/006 V1 语音/视觉 BYOK 提供商适配（ADR-009/011/013/035）
// 纯请求构造与响应解析（无 IO，单测友好）；key 只存宿主 dsh-credentials（TM-007），由路由层解析传入。
// 未实测的厂商路径不得广播能力（audit#7）：dashscope 语音文件识别在真实 key 实测前标记未验证。

export type VoiceProvider = 'openai' | 'groq' | 'dashscope'
export type VisionProvider = 'deepseek-ocr' | 'qwen-vl' | 'openai-vision' | 'grok-vision' | 'gemini'

/** 语音转录请求（audio = 完整音频文件字节；格式由前端录音决定，默认 webm） */
export interface VoiceRequest {
  provider: VoiceProvider
  apiKey: string
  audio: Buffer
  mimeType: string
}

/** 视觉描述请求（image = 图片字节） */
export interface VisionRequest {
  provider: VisionProvider
  apiKey: string
  image: Buffer
  mimeType: string
}

/** 提供商 HTTP 契约：URL + 请求头 + 请求体（JSON/base64 或 multipart 之外的二进制由调用方拼装） */
export interface ProviderCall {
  url: string
  headers: Record<string, string>
  body: Buffer
}

/** 语音请求契约（JSON base64 上传，三厂通用；字段名按厂微调） */
export function voiceCall(req: VoiceRequest): ProviderCall {
  const boundary = `----whalemaid-${Math.random().toString(36).slice(2)}`
  switch (req.provider) {
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/audio/transcriptions',
        headers: { authorization: `Bearer ${req.apiKey}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
        body: multipartBody([
          ['model', 'whisper-1'],
          ['file', req.audio, req.mimeType, 'audio.webm'],
        ], boundary),
      }
    case 'groq':
      return {
        url: 'https://api.groq.com/openai/v1/audio/transcriptions',
        headers: { authorization: `Bearer ${req.apiKey}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
        body: multipartBody([
          ['model', 'whisper-large-v3'],
          ['file', req.audio, req.mimeType, 'audio.webm'],
        ], boundary),
      }
    case 'dashscope':
      // 未实测（audit#7）：文件识别走 dashscope 异步任务；真实 key 实测前调用方应拒绝该路径
      throw new Error('dashscope 语音文件识别未经真实 key 实测，禁止使用（audit#7）')
  }
}

/** 语音响应解析：{ text } */
export function parseVoiceResponse(provider: VoiceProvider, raw: string): { text: string } {
  const data = JSON.parse(raw) as Record<string, unknown>
  if (provider === 'dashscope') {
    throw new Error('dashscope 语音未经实测，禁止使用（audit#7）')
  }
  const text = typeof data.text === 'string' ? data.text : ''
  if (!text) throw new Error(`语音转录响应缺少 text 字段`)
  return { text }
}

/** 视觉请求契约（openai 兼容 JSON base64 描述；deepseek-ocr/qwen-vl 走 OpenAI 兼容端点） */
export function visionCall(req: VisionRequest): ProviderCall {
  const base64 = req.image.toString('base64')
  const dataUrl = `data:${req.mimeType};base64,${base64}`
  switch (req.provider) {
    case 'deepseek-ocr':
      return {
        url: 'https://api.deepseek.com/chat/completions',
        headers: { authorization: `Bearer ${req.apiKey}`, 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: [
            { type: 'text', text: '请对这张图片做简短描述（OCR 文本 + 画面要点，100 字内），供没有视觉能力的模型理解。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] }],
          max_tokens: 300,
        })),
      }
    case 'qwen-vl':
      return {
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        headers: { authorization: `Bearer ${req.apiKey}`, 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({
          model: 'qwen-vl-max',
          messages: [{ role: 'user', content: [
            { type: 'text', text: '请对这张图片做简短描述（OCR 文本 + 画面要点，100 字内），供没有视觉能力的模型理解。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] }],
          max_tokens: 300,
        })),
      }
    case 'openai-vision':
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { authorization: `Bearer ${req.apiKey}`, 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: [
            { type: 'text', text: '请对这张图片做简短描述（OCR 文本 + 画面要点，100 字内），供没有视觉能力的模型理解。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] }],
          max_tokens: 300,
        })),
      }
    case 'grok-vision':
      return {
        url: 'https://api.x.ai/v1/chat/completions',
        headers: { authorization: `Bearer ${req.apiKey}`, 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({
          model: 'grok-2-vision-latest',
          messages: [{ role: 'user', content: [
            { type: 'text', text: '请对这张图片做简短描述（OCR 文本 + 画面要点，100 字内），供没有视觉能力的模型理解。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] }],
          max_tokens: 300,
        })),
      }
    case 'gemini':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(req.apiKey)}`,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({
          contents: [{ parts: [
            { text: '请对这张图片做简短描述（OCR 文本 + 画面要点，100 字内），供没有视觉能力的模型理解。' },
            { inline_data: { mime_type: req.mimeType, data: base64 } },
          ] }],
        })),
      }
  }
}

/** 视觉响应解析：{ description } */
export function parseVisionResponse(provider: VisionProvider, raw: string): { description: string } {
  const data = JSON.parse(raw) as Record<string, unknown>
  if (provider === 'gemini') {
    const text = extractFirstText(data.candidates)
    if (!text) throw new Error('视觉响应缺少文本')
    return { description: text }
  }
  const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined
  const content = choices?.[0]?.message?.content
  const text = typeof content === 'string'
    ? content
    : (content as Array<{ type?: string; text?: string }> | undefined)?.find((p) => p.type === 'text')?.text ?? ''
  if (!text) throw new Error('视觉响应缺少文本')
  return { description: text }
}

function extractFirstText(value: unknown): string {
  if (Array.isArray(value)) {
    for (const cand of value) {
      const parts = (cand as { content?: { parts?: Array<{ text?: string }> } })?.content?.parts ?? []
      for (const p of parts) if (typeof p.text === 'string' && p.text) return p.text
    }
  }
  return ''
}

/** 最小 multipart/form-data 拼装（字段少、单文件；boundary 由调用方生成并写入 content-type 头） */
export function multipartBody(fields: Array<[string, string] | [string, Buffer, string, string]>, boundary: string): Buffer {
  const parts: Buffer[] = []
  for (const f of fields) {
    if (typeof f[1] === 'string') {
      parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${f[0]}"\r\n\r\n${f[1]}\r\n`))
    } else {
      const [, content, mime, filename] = f as [string, Buffer, string, string]
      parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${f[0]}"; filename="${filename}"\r\ncontent-type: ${mime}\r\n\r\n`))
      parts.push(content)
      parts.push(Buffer.from('\r\n'))
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

export const VOICE_PROVIDERS: VoiceProvider[] = ['openai', 'groq', 'dashscope']
export const VISION_PROVIDERS: VisionProvider[] = ['deepseek-ocr', 'qwen-vl', 'openai-vision', 'grok-vision', 'gemini']
