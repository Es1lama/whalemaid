export class RelayConnectError extends Error {
  constructor(status, code, body) {
    super(code || `connect ${status}`)
    this.name = 'RelayConnectError'
    this.status = status
    this.code = code || 'RELAY_CONNECT_FAILED'
    this.body = body
  }
}

function decode(response) {
  let value
  try {
    value = JSON.parse(response.body)
  } catch {
    value = { error: response.body }
  }
  if (response.status !== 200) {
    throw new RelayConnectError(response.status, value.error, response.body)
  }
  return value
}

function assertCredentialKind(kind) {
  if (kind !== 'longTerm' && kind !== 'temporary') {
    throw new Error('credentialKind must be longTerm or temporary')
  }
}

export class GrantSession {
  server = ''
  deviceId = ''
  password = ''
  sessionToken = ''
  credentialKind = 'longTerm'

  get connected() {
    return this.server !== '' && this.deviceId !== '' && this.sessionToken !== ''
  }

  clear() {
    this.server = ''
    this.deviceId = ''
    this.password = ''
    this.sessionToken = ''
    this.credentialKind = 'longTerm'
  }

  async authenticate({ server, deviceId, password, credentialKind }, exchange) {
    assertCredentialKind(credentialKind)
    const result = decode(await exchange({ deviceId, password, credentialKind }))
    if (result.credentialKind !== credentialKind || typeof result.sessionToken !== 'string' || result.sessionToken === '') {
      throw new RelayConnectError(502, 'INVALID_RELAY_RESPONSE', JSON.stringify(result))
    }
    this.server = server
    this.deviceId = deviceId
    this.credentialKind = credentialKind
    this.password = credentialKind === 'longTerm' ? password : ''
    this.sessionToken = result.sessionToken
    return result
  }

  async requestGrant(exchange) {
    if (!this.connected) throw new RelayConnectError(401, 'INVALID_SESSION', '')
    let response = await exchange({ deviceId: this.deviceId, sessionToken: this.sessionToken })
    if (response.status === 401 && this.credentialKind === 'longTerm' && this.password !== '') {
      response = await exchange({
        deviceId: this.deviceId,
        password: this.password,
        credentialKind: 'longTerm',
      })
    }
    const result = decode(response)
    if (typeof result.sessionToken === 'string' && result.sessionToken !== '') this.sessionToken = result.sessionToken
    if (result.credentialKind !== this.credentialKind) {
      throw new RelayConnectError(502, 'INVALID_RELAY_RESPONSE', response.body)
    }
    return result
  }
}
