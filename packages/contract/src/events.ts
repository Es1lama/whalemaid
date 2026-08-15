// SPEC: docs/protocol.md#PROTO-001 SSE 帧（宿主 → 客户端事件流）
export interface ServerEventFrame {
  v: 1
  /** 单调递增，重连用 Last-Event-ID；轮询用 since=seq */
  seq: number
  type: ServerEventType
  payload: unknown
}

export type ServerEventType =
  | 'hello'
  | 'turn-status'
  | 'message'
  | 'tool-call'
  | 'permission-request'
  | 'permission-resolved'
  | 'device-revoked'

export interface TurnStatusPayload {
  sessionId: string
  status: 'running' | 'done' | 'interrupted'
}

export interface MessagePayload {
  sessionId: string
  /** 增量文本 */
  delta: string
}

export interface ToolCallPayload {
  sessionId: string
  name: string
  status: 'start' | 'end'
}

export interface PermissionRequestPayload {
  sessionId: string
  /** 宿主审批的稳定 rpcId（回应时必须回显） */
  rpcId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
}

export interface PermissionResolvedPayload {
  sessionId: string
  approvalId: string
  outcome: string
}

export interface DeviceRevokedPayload {
  reason: string
}
