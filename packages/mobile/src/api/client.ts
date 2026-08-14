// SPEC: docs/protocol.md#PROTO-001/003 客户端承载（信封 + 认证 + SSE/轮询）
import {
  AUTH_HEADER_PREFIX,
  PROTOCOL_VERSION,
  type BindPayload,
  type HandshakePayload,
  type RpcResponse,
  type ServerEventFrame,
} from '@whalemaid/contract'

export class WhaleClient {
  private token: string | null = null

  constructor(private base: string) {}

  get endpoint(): string {
    return this.base
  }

  setToken(token: string): void {
    this.token = token
  }

  private async call<M extends string, P, D>(method: M, payload: P): Promise<D> {
    const res = await fetch(`${this.base}/api/v1?method=${encodeURIComponent(method)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: AUTH_HEADER_PREFIX + this.token } : {}),
      },
      body: JSON.stringify({ v: PROTOCOL_VERSION, rpcId: crypto.randomUUID(), method, payload }),
    })
    const body = (await res.json()) as RpcResponse<D>
    if (!body.ok) throw new Error(`${body.error.code}: ${body.error.message}`)
    return body.data
  }

  handshake(payload: HandshakePayload): Promise<{ nonce: string; caps: string[] }> {
    return this.call('device.handshake', payload)
  }

  bind(payload: BindPayload): Promise<{ deviceToken: string }> {
    return this.call('device.bind', payload)
  }

  bindTemporary(payload: { deviceId: string; password: string }): Promise<{ deviceToken: string; expiresAt: number }> {
    return this.call('device.bindTemporary', payload)
  }

  sessionList(payload: object = {}): Promise<unknown> {
    return this.call('session.list', payload)
  }

  sessionCreate(payload: object = {}): Promise<unknown> {
    return this.call('session.create', payload)
  }

  sessionHistory(payload: { sessionId: string; maxMessages?: number }): Promise<unknown> {
    return this.call('session.history', payload)
  }

  prompt(payload: { sessionId: string; text: string; visionNote?: string }): Promise<unknown> {
    return this.call('session.prompt', payload)
  }

  stop(payload: { sessionId: string }): Promise<unknown> {
    return this.call('session.stop', payload)
  }

  models(payload: { sessionId: string }): Promise<unknown> {
    return this.call('session.models', payload)
  }

  selectModel(payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }): Promise<unknown> {
    return this.call('session.selectModel', payload)
  }

  permissionGet(payload: { sessionId: string }): Promise<unknown> {
    return this.call('permission.get', payload)
  }

  permissionSet(payload: { sessionId: string; value: string }): Promise<unknown> {
    return this.call('permission.set', payload)
  }

  workspaceList(): Promise<unknown> {
    return this.call('workspace.list', {})
  }

  listDirectory(payload: { path?: string } = {}): Promise<unknown> {
    return this.call('host.listDirectory', payload)
  }

  createDirectory(payload: { path: string; name: string }): Promise<unknown> {
    return this.call('host.createDirectory', payload)
  }

  workspaceCreate(payload: { path: string }): Promise<unknown> {
    return this.call('workspace.create', payload)
  }

  voiceTranscribe(payload: { audioBase64: string; format: string }): Promise<{ text: string }> {
    return this.call('voice.transcribe', payload)
  }

  visionDescribe(payload: { imageBase64: string; mime?: string }): Promise<{ text: string }> {
    return this.call('vision.describe', payload)
  }

  /** SSE 事件流；不支持时调用方降级轮询（PROTO-001） */
  events(onEvent: (frame: ServerEventFrame) => void, onDisconnect: () => void): () => void {
    const es = new EventSource(`${this.base}/api/v1/events`)
    es.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data) as ServerEventFrame)
      } catch {
        /* 忽略坏帧 */
      }
    }
    es.onerror = () => onDisconnect()
    return () => es.close()
  }
}
