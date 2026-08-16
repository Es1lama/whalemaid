import { describe, expect, it } from 'vitest'
import { appendTranscript, transcribeAudio } from './voice.ts'

describe('native voice transcription', () => {
  it('posts base64 audio with its native MIME type and returns trimmed text', async () => {
    let request: RequestInit | undefined
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init
      return new Response(JSON.stringify({ text: '  你好世界  ' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const text = await transcribeAudio(new File([new Uint8Array([1, 2, 3])], 'voice.m4a', { type: 'audio/mp4' }), fetchImpl)

    expect(text).toBe('你好世界')
    expect(request?.method).toBe('POST')
    const body = JSON.parse(String(request?.body)) as { audio: string; mimeType: string }
    expect(body.mimeType).toBe('audio/mp4')
    expect(Array.from(atob(body.audio), char => char.charCodeAt(0))).toEqual([1, 2, 3])
  })

  it('surfaces the host route error', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: '凭据未配置' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    await expect(transcribeAudio(new File(['a'], 'voice.m4a', { type: 'audio/mp4' }), fetchImpl))
      .rejects.toThrow('凭据未配置')
  })

  it('appends transcript text without rewriting the existing draft', () => {
    expect(appendTranscript('', '你好')).toBe('你好')
    expect(appendTranscript('已有内容', '你好')).toBe('已有内容 你好')
    expect(appendTranscript('已有内容\n', '你好')).toBe('已有内容\n你好')
  })
})
