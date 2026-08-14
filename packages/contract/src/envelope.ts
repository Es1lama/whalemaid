// SPEC: docs/protocol.md#PROTO-001 传输与信封
export const PROTOCOL_VERSION = 1

export type RpcId = string

export interface RpcRequest<M extends string = string, P = unknown> {
  v: typeof PROTOCOL_VERSION
  rpcId: RpcId
  method: M
  payload: P
}

export interface RpcOk<D = unknown> {
  v: typeof PROTOCOL_VERSION
  rpcId: RpcId
  ok: true
  data: D
}

export interface RpcFail {
  v: typeof PROTOCOL_VERSION
  rpcId: RpcId
  ok: false
  error: { code: string; message: string }
}

export type RpcResponse<D = unknown> = RpcOk<D> | RpcFail
