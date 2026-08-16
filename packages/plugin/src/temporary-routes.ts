import type { TemporaryPasswordManager } from './temporary.js'

interface RequestLike {
  method?: string
  headers: Record<string, string | string[] | undefined>
  on?: (event: string, callback: (chunk?: unknown) => void) => void
}

interface ResponseLike {
  writeHead(code: number, headers?: Record<string, string>): void
  end(body: string): void
}

export interface TemporaryRouteServer {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: RequestLike, res: ResponseLike) => void
  }): () => void
}

const CLIENT_HEADER = 'x-whalemaid-client'
export const TRANSPORT_ROLE_HEADER = 'x-whalemaid-transport-role'
const CONTROLLER_ROLE = 'controller'

class BadRequestError extends Error {}

function respond(res: ResponseLike, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

function isControllerTransport(req: RequestLike): boolean {
  const value = req.headers[TRANSPORT_ROLE_HEADER]
  const roles = Array.isArray(value) ? value : [value]
  return roles.some(role => typeof role === 'string' && role.trim().toLowerCase() === CONTROLLER_ROLE)
}

function authorized(req: RequestLike): boolean {
  return req.headers[CLIENT_HEADER] === '1' && !isControllerTransport(req)
}

function readJson(req: RequestLike): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type']
    if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
      reject(new BadRequestError('content-type 必须是 application/json'))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on?.('data', chunk => {
      const value = Buffer.from(chunk as Buffer)
      size += value.length
      if (size <= 4096) chunks.push(value)
    })
    req.on?.('end', () => {
      if (size > 4096) {
        reject(new BadRequestError('请求体过大'))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        reject(new BadRequestError('JSON 无效'))
      }
    })
    req.on?.('error', reject)
  })
}

export function registerTemporaryPasswordRoutes(
  server: TemporaryRouteServer,
  manager: TemporaryPasswordManager,
  deviceId: string,
): () => void {
  const disposeDevice = server.register({
    kind: 'exact',
    path: '/api/whalemaid/device',
    handler: (req, res) => {
      if (!authorized(req)) {
        respond(res, 403, { error: 'forbidden' })
        return
      }
      if (req.method !== 'GET') {
        respond(res, 405, { error: 'method not allowed' })
        return
      }
      respond(res, 200, { deviceId, temporaryPassword: manager.snapshot() })
    },
  })
  const disposeTemporary = server.register({
    kind: 'exact',
    path: '/api/whalemaid/temporary-password',
    handler: (req, res) => {
      if (!authorized(req)) {
        respond(res, 403, { error: 'forbidden' })
        return
      }
      if (req.method === 'DELETE') {
        void manager.revoke()
          .then(() => { respond(res, 200, { deviceId, temporaryPassword: manager.snapshot() }) })
          .catch(error => { respond(res, 502, { error: error instanceof Error ? error.message : String(error) }) })
        return
      }
      if (req.method !== 'POST') {
        respond(res, 405, { error: 'method not allowed' })
        return
      }
      void readJson(req)
        .then(body => {
          const ttlSec = Number(body.ttlSec)
          if (!Number.isInteger(ttlSec) || ttlSec < 60 || ttlSec > 86_400) {
            throw new BadRequestError('ttlSec 必须是 60 到 86400 之间的整数')
          }
          return manager.issue(ttlSec)
        })
        .then(temporaryPassword => { respond(res, 200, { deviceId, temporaryPassword }) })
        .catch(error => {
          const status = error instanceof BadRequestError ? 400 : 502
          respond(res, status, { error: error instanceof Error ? error.message : String(error) })
        })
    },
  })
  return () => {
    disposeTemporary()
    disposeDevice()
  }
}
