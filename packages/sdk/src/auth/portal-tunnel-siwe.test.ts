import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  buildPortalTunnelChallengeMessage,
  createPortalTunnelLeaseFlow,
} from './portal-tunnel-siwe'

const RELAY_BASE_URL = 'https://relay.example.com'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('buildPortalTunnelChallengeMessage', () => {
  it('produces a SIWE message byte-equal to portal-tunnel Go output', () => {
    const message = buildPortalTunnelChallengeMessage({
      domain: 'relay.example.com',
      uri: '/sdk/register',
      address: '0x14791697260E4c9A71f18484C9f997B308e59325',
      nonce: 'abc123xyz',
      requestId: 'rch_deadbeef',
      issuedAt: new Date('2026-04-18T10:00:00Z'),
      expiresAt: new Date('2026-04-18T10:02:00Z'),
    })

    const expected =
      'relay.example.com wants you to sign in with your Ethereum account:\n' +
      '0x14791697260E4c9A71f18484C9f997B308e59325\n' +
      '\n' +
      'Register a portal lease\n' +
      '\n' +
      'URI: /sdk/register\n' +
      'Version: 1\n' +
      'Chain ID: 1\n' +
      'Nonce: abc123xyz\n' +
      'Issued At: 2026-04-18T10:00:00Z\n' +
      'Expiration Time: 2026-04-18T10:02:00Z\n' +
      'Request ID: rch_deadbeef'

    expect(message).toBe(expected)
  })

  it('strips milliseconds from timestamps (matches Go time.RFC3339)', () => {
    const message = buildPortalTunnelChallengeMessage({
      domain: 'r.eth',
      uri: '/sdk/register',
      address: '0x14791697260E4c9A71f18484C9f997B308e59325',
      nonce: 'n',
      requestId: 'rch_x',
      issuedAt: new Date('2026-04-18T10:00:00.123Z'),
      expiresAt: new Date('2026-04-18T10:02:00.999Z'),
    })
    expect(message).toContain('Issued At: 2026-04-18T10:00:00Z')
    expect(message).toContain('Expiration Time: 2026-04-18T10:02:00Z')
    expect(message).not.toContain('.123Z')
    expect(message).not.toContain('.999Z')
  })

  it('checksums the address via viem.getAddress', () => {
    const message = buildPortalTunnelChallengeMessage({
      domain: 'r.eth',
      uri: '/sdk/register',
      // Lowercase input — must come out EIP-55 checksummed
      address: '0x14791697260e4c9a71f18484c9f997b308e59325',
      nonce: 'n',
      requestId: 'rch_x',
      issuedAt: new Date('2026-04-18T10:00:00Z'),
      expiresAt: new Date('2026-04-18T10:02:00Z'),
    })
    expect(message).toContain('0x14791697260E4c9A71f18484C9f997B308e59325')
  })
})

describe('createPortalTunnelLeaseFlow — fetchChallenge', () => {
  it('POSTs /sdk/register/challenge with the right body and parses the response', async () => {
    let receivedBody: unknown = null
    server.use(
      http.post(`${RELAY_BASE_URL}/sdk/register/challenge`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({
          challenge_id: 'rch_abc',
          expires_at: '2026-04-18T10:02:00Z',
          siwe_message: 'placeholder message',
        })
      }),
    )

    const flow = createPortalTunnelLeaseFlow({ relayBaseUrl: RELAY_BASE_URL })
    const challenge = await flow.fetchChallenge({
      identity: { address: '0x14791697260E4c9A71f18484C9f997B308e59325' },
      metadata: { description: 'demo relay', tags: ['demo'] },
      ttl: 3600,
      udpEnabled: true,
      tcpEnabled: false,
    })

    expect(challenge.challengeId).toBe('rch_abc')
    expect(challenge.siweMessage).toBe('placeholder message')
    expect(challenge.expiresAt.toISOString()).toBe('2026-04-18T10:02:00.000Z')

    // Request body must match Go struct field names (snake_case for wire).
    expect(receivedBody).toEqual({
      identity: { address: '0x14791697260E4c9A71f18484C9f997B308e59325' },
      metadata: { description: 'demo relay', tags: ['demo'] },
      ttl: 3600,
      udp_enabled: true,
      tcp_enabled: false,
    })
  })

  it('omits optional fields from the request body when not provided', async () => {
    let receivedBody: unknown = null
    server.use(
      http.post(`${RELAY_BASE_URL}/sdk/register/challenge`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({
          challenge_id: 'rch_x',
          expires_at: '2026-04-18T10:02:00Z',
          siwe_message: 'msg',
        })
      }),
    )
    const flow = createPortalTunnelLeaseFlow({ relayBaseUrl: RELAY_BASE_URL })
    await flow.fetchChallenge({
      identity: { address: '0x14791697260E4c9A71f18484C9f997B308e59325' },
    })
    expect(receivedBody).toEqual({
      identity: { address: '0x14791697260E4c9A71f18484C9f997B308e59325' },
    })
  })

  it('throws on non-2xx responses', async () => {
    server.use(
      http.post(`${RELAY_BASE_URL}/sdk/register/challenge`, () =>
        HttpResponse.json({ error: 'rate limited' }, { status: 429 }),
      ),
    )
    const flow = createPortalTunnelLeaseFlow({ relayBaseUrl: RELAY_BASE_URL })
    await expect(
      flow.fetchChallenge({
        identity: { address: '0x14791697260E4c9A71f18484C9f997B308e59325' },
      }),
    ).rejects.toThrow(/portal-tunnel challenge failed: 429/)
  })
})

describe('createPortalTunnelLeaseFlow — register', () => {
  it('POSTs /sdk/register with the right body and parses the lease response', async () => {
    let receivedBody: unknown = null
    server.use(
      http.post(`${RELAY_BASE_URL}/sdk/register`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({
          identity: {
            name: 'alice',
            address: '0x14791697260e4c9a71f18484c9f997b308e59325', // lowercase from server
          },
          expires_at: '2026-04-25T10:00:00Z',
          hostname: 'alice.relay.example.com',
          access_token: 'eyJhbGciOi.ES256K.stub',
          sni_port: 8443,
          udp_addr: 'relay.example.com:4433',
          udp_enabled: true,
        })
      }),
    )

    const flow = createPortalTunnelLeaseFlow({ relayBaseUrl: RELAY_BASE_URL })
    const lease = await flow.register({
      challengeId: 'rch_abc',
      siweMessage: 'placeholder message',
      siweSignature: '0xdeadbeef',
      reportedIp: '203.0.113.1',
    })

    expect(lease.identity.name).toBe('alice')
    // Address from server lowercase → checksummed on our side.
    expect(lease.identity.address).toBe('0x14791697260E4c9A71f18484C9f997B308e59325')
    expect(lease.accessToken).toBe('eyJhbGciOi.ES256K.stub')
    expect(lease.hostname).toBe('alice.relay.example.com')
    expect(lease.sniPort).toBe(8443)
    expect(lease.udpAddr).toBe('relay.example.com:4433')
    expect(lease.udpEnabled).toBe(true)
    expect(lease.tcpAddr).toBeUndefined()

    expect(receivedBody).toEqual({
      challenge_id: 'rch_abc',
      siwe_message: 'placeholder message',
      siwe_signature: '0xdeadbeef',
      reported_ip: '203.0.113.1',
    })
  })

  it('omits reported_ip when not provided', async () => {
    let receivedBody: unknown = null
    server.use(
      http.post(`${RELAY_BASE_URL}/sdk/register`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({
          identity: { name: 'bob', address: '0x14791697260E4c9A71f18484C9f997B308e59325' },
          expires_at: '2026-04-25T10:00:00Z',
          hostname: 'bob.relay.example.com',
          access_token: 'tok',
        })
      }),
    )
    const flow = createPortalTunnelLeaseFlow({ relayBaseUrl: RELAY_BASE_URL })
    await flow.register({
      challengeId: 'rch_abc',
      siweMessage: 'msg',
      siweSignature: '0xabcd',
    })
    expect(receivedBody).toEqual({
      challenge_id: 'rch_abc',
      siwe_message: 'msg',
      siwe_signature: '0xabcd',
    })
  })

  it('throws on non-2xx responses', async () => {
    server.use(
      http.post(`${RELAY_BASE_URL}/sdk/register`, () =>
        HttpResponse.json({ error: 'invalid signature' }, { status: 401 }),
      ),
    )
    const flow = createPortalTunnelLeaseFlow({ relayBaseUrl: RELAY_BASE_URL })
    await expect(
      flow.register({
        challengeId: 'rch_abc',
        siweMessage: 'msg',
        siweSignature: '0xabcd',
      }),
    ).rejects.toThrow(/portal-tunnel register failed: 401/)
  })
})

describe('createPortalTunnelLeaseFlow — config', () => {
  it('normalizes trailing slashes on relayBaseUrl', async () => {
    let hitUrl = ''
    server.use(
      http.post(`${RELAY_BASE_URL}/sdk/register/challenge`, ({ request }) => {
        hitUrl = request.url
        return HttpResponse.json({
          challenge_id: 'rch_x',
          expires_at: '2026-04-18T10:02:00Z',
          siwe_message: 'msg',
        })
      }),
    )
    const flow = createPortalTunnelLeaseFlow({
      relayBaseUrl: `${RELAY_BASE_URL}///`, // extra slashes
    })
    await flow.fetchChallenge({
      identity: { address: '0x14791697260E4c9A71f18484C9f997B308e59325' },
    })
    expect(hitUrl).toBe(`${RELAY_BASE_URL}/sdk/register/challenge`)
  })

  it('honors custom challengePath and registerPath', async () => {
    let challengeHit = false
    let registerHit = false
    server.use(
      http.post(`${RELAY_BASE_URL}/alt/challenge`, () => {
        challengeHit = true
        return HttpResponse.json({
          challenge_id: 'rch_x',
          expires_at: '2026-04-18T10:02:00Z',
          siwe_message: 'msg',
        })
      }),
      http.post(`${RELAY_BASE_URL}/alt/register`, () => {
        registerHit = true
        return HttpResponse.json({
          identity: { name: 'x', address: '0x14791697260E4c9A71f18484C9f997B308e59325' },
          expires_at: '2026-04-25T10:00:00Z',
          hostname: 'x.relay',
          access_token: 't',
        })
      }),
    )
    const flow = createPortalTunnelLeaseFlow({
      relayBaseUrl: RELAY_BASE_URL,
      challengePath: '/alt/challenge',
      registerPath: '/alt/register',
    })
    await flow.fetchChallenge({
      identity: { address: '0x14791697260E4c9A71f18484C9f997B308e59325' },
    })
    await flow.register({
      challengeId: 'rch_x',
      siweMessage: 'msg',
      siweSignature: '0xabcd',
    })
    expect(challengeHit).toBe(true)
    expect(registerHit).toBe(true)
  })
})
