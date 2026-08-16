import assert from 'node:assert/strict'
import test from 'node:test'
import { GrantSession, RelayConnectError } from './auth-session.mjs'

const ok = (token, kind = 'longTerm') => ({
  status: 200,
  body: JSON.stringify({ grant: `grant-${token}`, sessionToken: token, credentialKind: kind }),
})

test('temporary password is used once, then only its session token is sent', async () => {
  const payloads = []
  const session = new GrantSession()
  await session.authenticate({ server: 'relay.test', deviceId: 'WHALE-A', password: 'WMT-ABCD-EFGH', credentialKind: 'temporary' }, async payload => {
    payloads.push(payload)
    return ok('temp-session', 'temporary')
  })
  await session.requestGrant(async payload => {
    payloads.push(payload)
    return ok('temp-session', 'temporary')
  })

  assert.deepEqual(payloads, [
    { deviceId: 'WHALE-A', password: 'WMT-ABCD-EFGH', credentialKind: 'temporary' },
    { deviceId: 'WHALE-A', sessionToken: 'temp-session' },
  ])
  assert.equal(session.password, '')
})

test('temporary session rejection never falls back to the consumed password', async () => {
  const session = new GrantSession()
  await session.authenticate({ server: 'relay.test', deviceId: 'WHALE-A', password: 'WMT-ABCD-EFGH', credentialKind: 'temporary' }, async () => ok('temp-session', 'temporary'))
  let calls = 0
  await assert.rejects(
    session.requestGrant(async () => {
      calls += 1
      return { status: 401, body: JSON.stringify({ error: 'INVALID_SESSION' }) }
    }),
    error => error instanceof RelayConnectError && error.code === 'INVALID_SESSION',
  )
  assert.equal(calls, 1)
})

test('long-term session may fall back once to its in-process password', async () => {
  const payloads = []
  const session = new GrantSession()
  await session.authenticate({ server: 'relay.test', deviceId: 'WHALE-A', password: 'LONG-PASSWORD', credentialKind: 'longTerm' }, async () => ok('long-session'))
  const grant = await session.requestGrant(async payload => {
    payloads.push(payload)
    return payload.sessionToken
      ? { status: 401, body: JSON.stringify({ error: 'INVALID_SESSION' }) }
      : ok('renewed-session')
  })

  assert.equal(grant.grant, 'grant-renewed-session')
  assert.deepEqual(payloads, [
    { deviceId: 'WHALE-A', sessionToken: 'long-session' },
    { deviceId: 'WHALE-A', password: 'LONG-PASSWORD', credentialKind: 'longTerm' },
  ])
})

test('failed authentication does not commit connection state', async () => {
  const session = new GrantSession()
  await assert.rejects(
    session.authenticate({ server: 'relay.test', deviceId: 'WHALE-A', password: 'bad', credentialKind: 'temporary' }, async () => ({
      status: 409,
      body: JSON.stringify({ error: 'CREDENTIAL_CONSUMED' }),
    })),
    error => error instanceof RelayConnectError && error.code === 'CREDENTIAL_CONSUMED',
  )
  assert.equal(session.deviceId, '')
  assert.equal(session.server, '')
})
