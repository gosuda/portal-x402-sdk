import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { RelayDiscoveryError } from '../errors'
import { fetchDiscovery, PORTAL_TUNNEL_DISCOVERY_VERSION } from './discovery'

const RELAY_URL = 'https://relay.test.example'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const MINIMAL_RELAY = {
  name: 'relay-a',
  address: '0xrelay-a-address',
  version: 1,
  issued_at: '2026-04-19T10:00:00Z',
  expires_at: '2026-04-19T11:00:00Z',
  api_https_addr: 'https://relay-a.example',
  discovery: true,
}

describe('fetchDiscovery — happy path', () => {
  it('parses a valid discovery response and maps snake_case to camelCase', async () => {
    server.use(
      http.get(`${RELAY_URL}/discovery`, () =>
        HttpResponse.json({
          protocol_version: PORTAL_TUNNEL_DISCOVERY_VERSION,
          generated_at: '2026-04-19T10:00:00Z',
          relays: [
            {
              ...MINIMAL_RELAY,
              relay_id: 'relay-a-id',
              owner_address: '0xowner',
              ingress_tls_addr: 'relay-a.example:443',
              wireguard_public_key: 'wg-pubkey',
              wireguard_endpoint: 'wg.relay-a.example:51820',
              overlay_ipv4: '10.0.0.1',
              overlay_cidrs: ['10.0.0.0/24'],
              supports_udp: true,
              supports_tcp: true,
              supports_overlay_peer: false,
              load: 42,
              load_score: 1024,
              last_updated: 1713520800000,
            },
          ],
        }),
      ),
    )

    const result = await fetchDiscovery({ relayBaseUrl: RELAY_URL })
    expect(result.protocolVersion).toBe(PORTAL_TUNNEL_DISCOVERY_VERSION)
    expect(result.relays).toHaveLength(1)
    const relay = result.relays[0]
    expect(relay?.name).toBe('relay-a')
    expect(relay?.relayId).toBe('relay-a-id')
    expect(relay?.ownerAddress).toBe('0xowner')
    expect(relay?.ingressTlsAddr).toBe('relay-a.example:443')
    expect(relay?.wireguardPublicKey).toBe('wg-pubkey')
    expect(relay?.overlayCidrs).toEqual(['10.0.0.0/24'])
    expect(relay?.supportsUdp).toBe(true)
    expect(relay?.load).toBe(42)
    expect(relay?.loadScore).toBe(1024)
    expect(relay?.lastUpdated).toBe(1713520800000)
    expect(relay?.expiresAt.toISOString()).toBe('2026-04-19T11:00:00.000Z')
  })

  it('defaults omitted optional fields (matches Go omitempty behaviour)', async () => {
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
    expect(relay?.relayId).toBe('')
    expect(relay?.overlayCidrs).toEqual([])
    expect(relay?.supportsUdp).toBe(false)
    expect(relay?.load).toBe(0)
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

  it('rejects on protocol version mismatch', async () => {
    server.use(
      http.get(`${RELAY_URL}/discovery`, () =>
        HttpResponse.json({
          protocol_version: '5', // SDKVersion, not DiscoveryVersion
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
        HttpResponse.json({ protocol_version: '6' /* missing relays[] */ }),
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
