// V1 提供商纯逻辑单测（先红后绿；无网络）
import { describe, expect, it } from 'vitest'
import { voiceCall, visionCall, parseVoiceResponse, parseVisionResponse, multipartBody } from './providers.js'

describe('voiceCall', () => {
  it('openai: multipart 含 boundary/文件名/model', () => {
    const call = voiceCall({ provider: 'openai', apiKey: 'k', audio: Buffer.from('abc'), mimeType: 'audio/webm' })
    expect(call.url).toContain('api.openai.com')
    expect(call.headers.authorization).toBe('Bearer k')
    expect(call.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    const body = call.body.toString('utf8')
    expect(body).toContain('name="model"')
    expect(body).toContain('whisper-1')
    expect(body).toContain('filename="audio.webm"')
    expect(body).toContain('abc')
  })

  it('groq: 不同 model 与端点', () => {
    const call = voiceCall({ provider: 'groq', apiKey: 'k', audio: Buffer.from('x'), mimeType: 'audio/webm' })
    expect(call.url).toContain('api.groq.com')
    expect(call.body.toString('utf8')).toContain('whisper-large-v3')
  })

  it('dashscope 未经实测拒绝（audit#7）', () => {
    expect(() => voiceCall({ provider: 'dashscope', apiKey: 'k', audio: Buffer.from('x'), mimeType: 'audio/webm' }))
      .toThrow(/未经真实 key 实测/)
  })
})

describe('visionCall', () => {
  it('openai-vision: JSON base64 data-url + 中文描述提示', () => {
    const call = visionCall({ provider: 'openai-vision', apiKey: 'k', image: Buffer.from('img'), mimeType: 'image/png' })
    const body = JSON.parse(call.body.toString('utf8')) as Record<string, unknown>
    expect(call.url).toContain('api.openai.com')
    expect(body.model).toBe('gpt-4o-mini')
    const content = (body.messages as Array<{ content: unknown }>)[0].content as Array<{ type: string }>
    expect(content.some((p) => p.type === 'image_url')).toBe(true)
    expect(JSON.stringify(body)).toContain('data:image/png;base64')
  })

  it('gemini: inline_data 结构', () => {
    const call = visionCall({ provider: 'gemini', apiKey: 'k', image: Buffer.from('img'), mimeType: 'image/jpeg' })
    expect(call.url).toContain('generativelanguage.googleapis.com')
    expect(call.url).toContain('key=k')
    const body = JSON.parse(call.body.toString('utf8')) as Record<string, unknown>
    expect(JSON.stringify(body)).toContain('"inline_data"')
  })

  it('deepseek-ocr/qwen-vl 走 OpenAI 兼容端点', () => {
    expect(visionCall({ provider: 'deepseek-ocr', apiKey: 'k', image: Buffer.from('x'), mimeType: 'image/png' }).url)
      .toContain('api.deepseek.com')
    expect(visionCall({ provider: 'qwen-vl', apiKey: 'k', image: Buffer.from('x'), mimeType: 'image/png' }).url)
      .toContain('dashscope.aliyuncs.com')
  })
})

describe('响应解析', () => {
  it('语音: 取 text 字段；缺失报错', () => {
    expect(parseVoiceResponse('openai', JSON.stringify({ text: '你好' })).text).toBe('你好')
    expect(() => parseVoiceResponse('openai', JSON.stringify({}))).toThrow(/缺少 text/)
  })

  it('视觉: openai 兼容 choices[0].message.content（字符串或分段）', () => {
    expect(parseVisionResponse('openai-vision', JSON.stringify({
      choices: [{ message: { content: [{ type: 'text', text: '一张图片' }] } }],
    })).description).toBe('一张图片')
    expect(parseVisionResponse('qwen-vl', JSON.stringify({
      choices: [{ message: { content: '纯文本' } }],
    })).description).toBe('纯文本')
    expect(() => parseVisionResponse('openai-vision', JSON.stringify({ choices: [] }))).toThrow(/缺少文本/)
  })

  it('视觉 gemini: candidates[].content.parts[].text', () => {
    expect(parseVisionResponse('gemini', JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'gemini 描述' }] } }],
    })).description).toBe('gemini 描述')
  })
})

describe('multipartBody', () => {
  it('boundary 首尾一致', () => {
    const body = multipartBody([['a', '1']], 'BOUNDARY')
    const text = body.toString('utf8')
    expect(text.startsWith('--BOUNDARY')).toBe(true)
    expect(text.endsWith('--BOUNDARY--\r\n')).toBe(true)
  })
})
