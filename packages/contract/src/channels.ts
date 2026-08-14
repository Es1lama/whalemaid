// SPEC: docs/protocol.md#PROTO-005 语音通道（知情同意通道）
// SPEC: docs/protocol.md#PROTO-006 视觉通道（知情同意通道）

/** v1 ASR 注册表（可插拔，ADR-009）：BYOK 厂商预制 */
export const VOICE_PROVIDERS = {
  /** 阿里 DashScope Paraformer-v2（录音文件识别） */
  dashscope: 'dashscope',
  /** OpenAI whisper-1（audio/transcriptions） */
  openai: 'openai',
  /** Groq whisper-large-v3（OpenAI 兼容） */
  groq: 'groq',
  /** 讯飞（预留，待接入） */
  iflytek: 'iflytek',
} as const

export type VoiceProvider = (typeof VOICE_PROVIDERS)[keyof typeof VOICE_PROVIDERS]

/** v1 视觉注册表（ADR-035：国内优先，海外可选） */
export const VISION_PROVIDERS = {
  /** DeepSeek-OCR（OpenAI 兼容 chat） */
  deepseekOcr: 'deepseek-ocr',
  /** 通义千问 VL（max/plus 由 model 决定，OpenAI 兼容模式） */
  qwenVl: 'qwen-vl',
  /** OpenAI 视觉（GPT-5.6 等） */
  openai: 'openai-vision',
  /** xAI Grok 视觉 */
  grok: 'grok-vision',
  /** Google Gemini（generateContent） */
  gemini: 'gemini',
} as const

export type VisionProvider = (typeof VISION_PROVIDERS)[keyof typeof VISION_PROVIDERS]

/** BYOK 厂商配置：key 经宿主 dsh-credentials 引用（ADR-013），绝不落手机/中继 */
export interface ProviderConfig {
  provider: string
  /** dsh-credentials 引用名，如 DASHSCOPE_API_KEY */
  credentialRef?: string
  model?: string
  baseUrl?: string
}

export interface VoiceTranscribePayload {
  /** base64 音频（一次性录音上传，流式留 V2） */
  audioBase64: string
  format: 'wav' | 'pcm' | 'mp3' | 'm4a'
}

export interface VoiceTranscribeData {
  text: string
}

/** 热词更新（仅宿主热词插件安装且开启时存在，ADR-010） */
export interface HotwordsUpdatePayload {
  add: string[]
  remove: string[]
}

export interface VisionDescribePayload {
  imageBase64: string
  /** 图片 MIME，如 image/png */
  mime?: string
}

export interface VisionDescribeData {
  text: string
}
