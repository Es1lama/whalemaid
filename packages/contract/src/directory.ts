// SPEC: docs/protocol.md#PROTO-007 目录浏览与工作区创建
// SPEC: docs/adr/INDEX.md#ADR-008 范围策略（默认限工作区根，全盘需二次确认）

export interface DirectoryEntry {
  name: string
  hidden: boolean
}

export interface DirectoryListing {
  path: string
  entries: DirectoryEntry[]
  /** 根到目标的祖先链 */
  crumbs: string[]
  truncated: boolean
}

export interface ListDirectoryPayload {
  path?: string
  /** 全盘浏览需长期密码二次确认，宿主策略校验 */
  scope?: 'default' | 'full'
}

export interface CreateDirectoryPayload {
  path: string
  name: string
}

export interface WorkspaceCreatePayload {
  path: string
}

export interface WorkspaceCreateData {
  workspaceId: string
  created: boolean
}
