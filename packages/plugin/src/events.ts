// SPEC: docs/protocol.md#PROTO-001 SSE 事件流（宿主 → 客户端）
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ServerEventFrame } from '@whalemaid/contract'

/** 内存事件中枢：广播 + 有限回放（轮询降级用） */
export class EventHub {
  private seq = 0
  private subscribers = new Set<ServerResponse>()
  private history: ServerEventFrame[] = []
  private timer: NodeJS.Timeout | undefined

  constructor(private keepLast = 200) {
    this.timer = setInterval(() => this.push('hello', { at: Date.now() }), 15_000)
    this.timer.unref()
  }

  push(type: ServerEventFrame['type'], payload: unknown): void {
    const frame: ServerEventFrame = { v: 1, seq: ++this.seq, type, payload }
    this.history.push(frame)
    if (this.history.length > this.keepLast) this.history = this.history.slice(-this.keepLast)
    const data = `data: ${JSON.stringify(frame)}\n\n`
    for (const res of this.subscribers) res.write(data)
  }

  replay(since: number): ServerEventFrame[] {
    return this.history.filter((f) => f.seq > since)
  }

  subscribe(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write('retry: 3000\n\n')
    // 连接即回放历史帧（含 mux 重放的待审批请求——恢复基线，PROTO-004）
    for (const frame of this.history) res.write(`data: ${JSON.stringify(frame)}\n\n`)
    this.subscribers.add(res)
    res.on('close', () => this.subscribers.delete(res))
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    for (const res of this.subscribers) res.end()
    this.subscribers.clear()
  }
}
