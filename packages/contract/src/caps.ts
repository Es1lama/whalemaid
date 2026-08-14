// SPEC: docs/protocol.md#PROTO-002 capability 广播
export const CAPABILITIES = {
  session: 'session',
  workspaceCreate: 'workspace-create',
  directoryBrowse: 'directory-browse',
  voiceByok: 'voice-byok',
  visionByok: 'vision-byok',
  hotwords: 'hotwords',
  relay: 'relay',
  direct: 'direct',
} as const

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]
