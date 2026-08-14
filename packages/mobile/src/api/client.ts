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

  sessionList(payload: object = {}): Promise<unknown> {
    return this.call('session.list', payload)
  }

  sessionCreate(payload: object = {}): Promise<unknown> {
    return this.call('session.create', payload)
  }

  prompt(payload: { sessionId: string; text: string; visionNote?: string }): Promise<unknown> {
    return this.call('session.prompt', payload)
  }

  stop(payload: { sessionId: string }): Promise<unknown> {
    return this.call('session.stop', payload)
  }

  listDirectory(payload: { path?: string } = {}): Promise<unknown> {
    return this.call('host.listDirectory', payload)
  }

  workspaceCreate(payload: { path: string }): Promise<unknown> {
    return this.call('workspace.create', payload)
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
