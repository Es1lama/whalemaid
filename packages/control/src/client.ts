// SPEC: docs/protocol.md 控制端 Node 客户端（宿主侧，供 agent 工具调用；与手机端同协议）
export class WhaleNodeClient {
  private token: string | null = null
  private base = ''

  constructor(base: string) {
    this.base = base.replace(/\/$/, '')
  }

  /** 工具调用映射：whalemaid_<action> → 协议方法 */
  async callTool(action: string, args: Record<string, string>, cfg: { base: string; deviceId: string; password: string }): Promise<string> {
    const base = args.base || cfg.base
    if (!base) throw new Error('未配置被控端地址（base）')
    if (base !== this.base) this.base = base.replace(/\/$/, '')

    // 惰性连接（一次握手绑定，token 复用）
    if (!this.token) {
      const deviceId = args.deviceId || cfg.deviceId
      const password = args.password || cfg.password
      if (!deviceId || !password) throw new Error('未配置 deviceId/password')
      await this.connect(deviceId, password)
    }

    switch (action) {
      case 'connect':
        return JSON.stringify({ connected: true, base: this.base })
      case 'session_list':
        return JSON.stringify(await this.call('session.list', {}))
      case 'session_create':
        return JSON.stringify(await this.call('session.create', args.workspaceId ? { workspaceId: args.workspaceId } : {}))
      case 'prompt':
        return JSON.stringify(await this.call('session.prompt', { sessionId: args.sessionId, text: args.text }))
      case 'history':
        return JSON.stringify(await this.call('session.history', { sessionId: args.sessionId, maxMessages: 30 }))
      case 'stop':
        return JSON.stringify(await this.call('session.stop', { sessionId: args.sessionId }))
      case 'pending_approvals':
        return JSON.stringify(await this.pendingApprovals(args.sessionId))
      case 'approval_respond':
        return JSON.stringify(await this.call('approval.respond', {
          rpcId: args.rpcId, sessionId: args.sessionId, approvalId: args.approvalId, outcome: args.outcome,
        }))
      case 'workspace_list':
        return JSON.stringify(await this.call('workspace.list', {}))
      case 'workspace_create':
        return JSON.stringify(await this.call('workspace.create', { path: args.path }))
      case 'list_directory':
        return JSON.stringify(await this.call('host.listDirectory', args.path ? { path: args.path } : {}))
      case 'permission_set':
        return JSON.stringify(await this.call('permission.set', { sessionId: args.sessionId, value: args.value }))
      default:
        throw new Error(`未知控制动作: ${action}`)
    }
  }

  private async connect(deviceId: string, password: string): Promise<void> {
    // Node 端 ECDSA：用 node:crypto 生成 P-256 密钥对 + 签名（控制端身份，无需硬件级存储）
    const { generateKeyPairSync, sign, createPublicKey } = await import('node:crypto')
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = createPublicKey(publicKey).export({ format: 'jwk' })
    const hs = (await this.call('device.handshake', { deviceId, publicKeyJwk: jwk })) as { nonce: string }
    const sig = sign('sha256', Buffer.from(hs.nonce, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
    const bind = (await this.call('device.bind', { deviceId, nonce: hs.nonce, password, nonceSignature: sig })) as { deviceToken: string }
    this.token = bind.deviceToken
  }

  private async call(method: string, payload: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}/api/v1?method=${encodeURIComponent(method)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ v: 1, rpcId: crypto.randomUUID(), method, payload }),
    })
    const body = (await res.json()) as { ok: boolean; data?: unknown; error?: { code: string; message: string } }
    if (!body.ok) throw new Error(`${body.error?.code}: ${body.error?.message}`)
    return body.data
  }

  /** 轮询待审批（SSE 历史回放通道，PROTO-004） */
  private async pendingApprovals(sessionId: string): Promise<unknown> {
    const res = await fetch(`${this.base}/api/v1/poll?since=0`, {
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
    })
    const body = (await res.json()) as { events?: Array<{ type: string; payload: Record<string, unknown> }> }
    const pending = (body.events ?? [])
      .filter((e) => e.type === 'permission-request' && String(e.payload.sessionId) === sessionId)
      .map((e) => e.payload)
    return { pending }
  }
}
