// SPEC: docs/protocol.md#PROTO-008 错误码表
export const ERROR_CODES = {
  badRequest: 'bad-request',
  authFailed: 'auth-failed',
  deviceRevoked: 'device-revoked',
  tokenExpired: 'token-expired',
  rateLimited: 'rate-limited',
  methodUnknown: 'method-unknown',
  capUnsupported: 'cap-unsupported',
  directoryUnreadable: 'directory-unreadable',
  directoryExists: 'directory-exists',
  directoryCreateFailed: 'directory-create-failed',
  scopeDenied: 'scope-denied',
  serverError: 'server-error',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
