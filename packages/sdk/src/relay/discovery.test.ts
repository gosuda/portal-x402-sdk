import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { RelayDiscoveryError } from '../errors'
import {
  fetchDiscovery,
  hasOverlayPeer,
  PORTAL_TUNNEL_DISCOVERY_VERSION,
  PORTAL_TUNNEL_SDK_VERSION,
} from './discovery'

const RELAY_URL = 'https://relay.test.example'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const MINIMAL_RELAY = {
  address: '0x0000000000000000000000000000000000000001',
  version: 'v2.1.7',
  issued_at: '2026-04-19T10:00:00Z',
  expires_at: '2026-04-19T11:00:00Z',
  api_https_addr: 'https://relay-a.example',
}

describe('version constants', () => {
  it('pins DiscoveryVersion to the portal-tunnel v2.1.7 value', () => {
    expect(PORTAL_TUNNEL_DISCOVERY_VERSION).toBe('7')
  })

  it('pins SDKVersion to the portal-tunnel v2.1.7 value', () => {
    expect(PORTAL_TUNNEL_SDK_VERSION).toBe('6')
  })
})

describe('fetchDiscovery — happy path', () => {
  it('parses a fully populated descriptor and maps snake_case to camelCase', async () => {
    server.use(
      http.get(`${RELAY_URL}/discovery`, () =>
        HttpResponse.json({
          protocol_version: PORTAL_TUNNEL_DISCOVERY_VERSION,
          generated_at: '2026-04-19T10:00:00Z',
          relays: [
            {
              ...MINIMAL_RELAY,
              wireguard_public_key: 'wg-pubkey',
              wireguard_port: 51820,
              supports_overlay: true,
              supports_udp: true,
              supports_tcp: true,
              active_connections: 42,
              tcp_bps: 1_048_576,
              signature: 'c2lnbmF0dXJlLWJhc2U2NA==',
            },
          ],
        }),
      ),
    )

    const result = await fetchDiscovery({ relayBaseUrl: RELAY_URL })
    expect(result.protocolVersion).toBe(PORTAL_TUNNEL_DISCOVERY_VERSION)
    expect(result.relays).toHaveLength(1)
    const relay = result.relays[0]
    expect(relay?.address).toBe('0x0000000000000000000000000000000000000001')
    expect(relay?.version).toBe('v2.1.7')
    expect(relay?.apiHttpsAddr).toBe('https://relay-a.example')
    expect(relay?.wireGuardPublicKey).toBe('wg-pubkey')
    expect(relay?.wireGuardPort).toBe(51820)
    expect(relay?.supportsOverlay).toBe(true)
    expect(relay?.supportsUdp).toBe(true)
    expect(relay?.supportsTcp).toBe(true)
    expect(relay?.activeConnections).toBe(42)
    expect(relay?.tcpBps).toBe(1_048_576)
    expect(relay?.signature).toBe('c2lnbmF0dXJlLWJhc2U2NA==')
    expect(relay?.expiresAt.toISOString()).toBe('2026-04-19T11:00:00.000Z')
  })

  it('defaults omitted optional fields to zero values (matches Go omitempty)', async () => {
    server.use(
      http.get(`${RELAY_URL}/discovery`, () =>
        HttpResponse.json({
          protocol_version: PORTAL_TUNNEL_DISCOVERY_VERSION,
          generated_at: '2026-04-19T10:00:00Z',
          relays: [MINIMAL_RELAY],
        }),
      ),
    )

    const result = await fetchDiscovery({ relayBaseUrl: RELAY_URL })
    const relay = result.relays[0]
    expect(relay?.wireGuardPublicKey).toBe('')
    expect(relay?.wireGuardPort).toBe(0)
    expect(relay?.supportsOverlay).toBe(false)
    expect(relay?.supportsUdp).toBe(false)
    expect(relay?.supportsTcp).toBe(false)
    expect(relay?.activeConnections).toBe(0)
    expect(relay?.tcpBps).toBe(0)
    expect(relay?.signature).toBe('')
  })

  it('normalizes trailing slashes on relayBaseUrl', async () => {
    let hitUrl = ''
    server.use(
      http.get(`${RELAY_URL}/discovery`, ({ request }) => {
        hitUrl = request.url
        return HttpResponse.json({
          protocol_version: PORTAL_TUNNEL_DISCOVERY_VERSION,
          generated_at: '2026-04-19T10:00:00Z',
          relays: [],
        })
      }),
    )
    await fetchDiscovery({ relayBaseUrl: `${RELAY_URL}///` })
    expect(hitUrl).toBe(`${RELAY_URL}/discovery`)
  })

  it('honors a custom path override', async () => {
    server.use(
      http.get(`${RELAY_URL}/alt/discovery`, () =>
        HttpResponse.json({
          protocol_version: PORTAL_TUNNEL_DISCOVERY_VERSION,
          generated_at: '2026-04-19T10:00:00Z',
          relays: [],
        }),
      ),
    )
    const result = await fetchDiscovery({
      relayBaseUrl: RELAY_URL,
      path: '/alt/discovery',
    })
    expect(result.relays).toHaveLength(0)
  })
})

describe('fetchDiscovery — error paths', () => {
  it('rejects with RelayDiscoveryError on 404 (discovery disabled)', async () => {
    server.use(http.get(`${RELAY_URL}/discovery`, () => new HttpResponse(null, { status: 404 })))
    try {
      await fetchDiscovery({ relayBaseUrl: RELAY_URL })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayDiscoveryError)
      if (err instanceof RelayDiscoveryError) {
        expect(err.bootstrapUrl).toBe(`${RELAY_URL}/discovery`)
      }
    }
  })

  it('rejects on protocol version mismatch (pre-v2.1.7 response)', async () => {
    server.use(
      http.get(`${RELAY_URL}/discovery`, () =>
        HttpResponse.json({
          protocol_version: '6', // pre-v2.1.7 DiscoveryVersion
          generated_at: '2026-04-19T10:00:00Z',
          relays: [],
        }),
      ),
    )
    await expect(fetchDiscovery({ relayBaseUrl: RELAY_URL })).rejects.toBeInstanceOf(
      RelayDiscoveryError,
    )
  })

  it('rejects on malformed response shape', async () => {
    server.use(
      http.get(`${RELAY_URL}/discovery`, () =>
        HttpResponse.json({ protocol_version: '7' /* missing relays[] */ }),
      ),
    )
    await expect(fetchDiscovery({ relayBaseUrl: RELAY_URL })).rejects.toBeInstanceOf(
      RelayDiscoveryError,
    )
  })

  it('rejects on non-JSON body', async () => {
    server.use(
      http.get(`${RELAY_URL}/discovery`, () => new HttpResponse('not json', { status: 200 })),
    )
    await expect(fetchDiscovery({ relayBaseUrl: RELAY_URL })).rejects.toBeInstanceOf(
      RelayDiscoveryError,
    )
  })

  it('re-throws caller abort unchanged', async () => {
    server.use(
      http.get(`${RELAY_URL}/discovery`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return HttpResponse.json({
          protocol_version: PORTAL_TUNNEL_DISCOVERY_VERSION,
          generated_at: '2026-04-19T10:00:00Z',
          relays: [],
        })
      }),
    )
    const controller = new AbortController()
    queueMicrotask(() => controller.abort())
    await expect(
      fetchDiscovery({ relayBaseUrl: RELAY_URL, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('hasOverlayPeer', () => {
  const base = {
    address: '0xa',
    version: 'v2.1.7',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    apiHttpsAddr: 'https://x',
    supportsUdp: false,
    supportsTcp: false,
    activeConnections: 0,
    tcpBps: 0,
    signature: '',
  }

  it('returns true when overlay flag + key + valid port all set', () => {
    expect(
      hasOverlayPeer({
        ...base,
        supportsOverlay: true,
        wireGuardPublicKey: 'pk',
        wireGuardPort: 51820,
      }),
    ).toBe(true)
  })

  it('returns false when the overlay flag is off', () => {
    expect(
      hasOverlayPeer({
        ...base,
        supportsOverlay: false,
        wireGuardPublicKey: 'pk',
        wireGuardPort: 51820,
      }),
    ).toBe(false)
  })

  it('returns false when the public key is blank', () => {
    expect(
      hasOverlayPeer({
        ...base,
        supportsOverlay: true,
        wireGuardPublicKey: '   ',
        wireGuardPort: 51820,
      }),
    ).toBe(false)
  })

  it('returns false when the port is outside the valid range', () => {
    expect(
      hasOverlayPeer({
        ...base,
        supportsOverlay: true,
        wireGuardPublicKey: 'pk',
        wireGuardPort: 0,
      }),
    ).toBe(false)
  })
})
