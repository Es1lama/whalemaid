/** Browser-side adapter for WhaleMaid's host-resident BYOK transcription route. */

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, offset + 0x8000)
    let binary = ''
    for (const byte of chunk) binary += String.fromCharCode(byte)
    parts.push(binary)
  }
  return globalThis.btoa(parts.join(''))
}

/** Transcribe one complete native recording through the controlled host. */
export async function transcribeAudio(file: File, fetchImpl: typeof fetch = fetch): Promise<string> {
  const audio = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
  const response = await fetchImpl('/api/whalemaid/voice.transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio, mimeType: file.type || 'audio/mp4' }),
  })
  const payload = await response.json().catch(() => ({})) as { readonly text?: unknown; readonly error?: unknown }
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `语音转录失败 (${response.status})`)
  }
  if (typeof payload.text !== 'string' || payload.text.trim() === '') throw new Error('语音转录响应缺少 text')
  return payload.text.trim()
}

/** Append a transcript without collapsing the user's existing draft. */
export function appendTranscript(draft: string, transcript: string): string {
  if (draft === '') return transcript
  return `${draft}${/\s$/u.test(draft) ? '' : ' '}${transcript}`
}
