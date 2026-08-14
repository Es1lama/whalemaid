// SPEC: docs/protocol.md#PROTO-005 语音通道（知情同意通道）
// SPEC: docs/protocol.md#PROTO-006 视觉通道（知情同意通道）

/** v1 ASR 注册表（可插拔，ADR-009） */
export const VOICE_PROVIDERS = {
  dashscopeParaformer: 'dashscope-paraformer',
} as const

export type VoiceProvider = (typeof VOICE_PROVIDERS)[keyof typeof VOICE_PROVIDERS]

/** v1 视觉注册表（ADR-035：国内优先） */
export const VISION_PROVIDERS = {
  deepseekOcr: 'deepseek-ocr',
  qwenVlMax: 'qwen-vl-max',
  qwenVlPlus: 'qwen-vl-plus',
} as const

export type VisionProvider = (typeof VISION_PROVIDERS)[keyof typeof VISION_PROVIDERS]

export interface VoiceTranscribePayload {
  /** base64 音频（一次性录音上传，流式留 V2） */
  audioBase64: string
  format: 'wav' | 'pcm' | 'mp3'
  provider: VoiceProvider
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
  provider: VisionProvider
}

export interface VisionDescribeData {
  text: string
}
