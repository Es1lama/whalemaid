/** Runtime role stamped into tunneled HTML by the native controller shell before DSH boots. */
export const CONTROLLER_RUNTIME_ROLE = 'controller'
export const RUNTIME_ROLE_GLOBAL = '__WHALEMAID_RUNTIME_ROLE__'

export function isControllerRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & { __WHALEMAID_RUNTIME_ROLE__?: unknown }
  return runtime.__WHALEMAID_RUNTIME_ROLE__ === CONTROLLER_RUNTIME_ROLE
}
