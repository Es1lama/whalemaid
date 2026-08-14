// SPEC: docs/protocol.md#PROTO-004 会话通道（E2E 主通道）
// 语义一一对应 DSH 原生（dsh-host-apiproxy），薄转发不改业务。

export interface SessionSummary {
  sessionId: string
  title: string
  updatedAt: number
  blank: boolean
}

export interface ListSessionsPayload {
  cursor?: string
}

export interface ListSessionsData {
  items: SessionSummary[]
  nextCursor?: string
  hasMore: boolean
}

export interface HistoryPayload {
  sessionId: string
  cursor?: string
}

export interface PromptPayload {
  sessionId: string
  text: string
  /** 视觉通道产物（PROTO-006），可选 */
  visionNote?: string
}

export interface CreateSessionPayload {
  workspaceId?: string
}

export interface CreateSessionData {
  sessionId: string
}

export interface SelectModelPayload {
  sessionId: string
  provider: string
  model: string
  reasoningEffort?: string
}

export interface PermissionPayload {
  sessionId: string
  value: string
}
