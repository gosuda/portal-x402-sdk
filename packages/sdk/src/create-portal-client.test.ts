import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { createPortalClient } from './create-portal-client'
import { ERC8004_ADDRESSES } from './erc8004/addresses'

type PublicMock = {
  readContract: ReturnType<typeof vi.fn>
  waitForTransactionReceipt: ReturnType<typeof vi.fn>
  getEnsName: ReturnType<typeof vi.fn>
  getEnsText: ReturnType<typeof vi.fn>
}

function makePublicClient(): PublicClient & PublicMock {
  return {
    readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    getEnsName: vi.fn(),
    getEnsText: vi.fn(),
  } as PublicClient & PublicMock
}

describe('createPortalClient — payment-only (default)', () => {
  it('returns facilitator + paidFetch + createHonoMiddleware with no identity', () => {
    const client = createPortalClient({
      payment: {
        paidFetch: {
          schemes: [
            {
              network: 'eip155:8453',
              client: {
                scheme: 'exact',
                async createPaymentPayload() {
                  return { x402Version: 2, payload: {} }
                },
              },
            },
          ],
        },
      },
    })
    expect(typeof client.facilitator).toBe('object')
    expect(typeof client.paidFetch).toBe('function')
    expect(typeof client.createHonoMiddleware).toBe('function')
    expect(client.identity).toBeUndefined()
  })

  it('defaults to the public x402 facilitator URL when no payment config supplied', () => {
    const client = createPortalClient({
      payment: {
        paidFetch: {
          schemes: [
            {
              network: 'eip155:8453',
              client: {
                scheme: 'exact',
                async createPaymentPayload() {
                  return { x402Version: 2, payload: {} }
                },
              },
            },
          ],
        },
      },
    })
    expect(client.facilitator.url).toBe('https://x402.org/facilitator')
  })

  it('honors a custom facilitator URL', () => {
    const client = createPortalClient({
      payment: {
        facilitator: { url: 'https://facilitator.portal.test' },
        paidFetch: {
          schemes: [
            {
              network: 'eip155:8453',
              client: {
                scheme: 'exact',
                async createPaymentPayload() {
                  return { x402Version: 2, payload: {} }
                },
              },
            },
          ],
        },
      },
    })
    expect(client.facilitator.url).toBe('https://facilitator.portal.test')
  })
})

describe('createPortalClient — identity layer', () => {
  it('exposes identity handles when config.identity is provided', () => {
    const publicClient = makePublicClient()
    const client = createPortalClient({
      payment: {
        paidFetch: {
          schemes: [
            {
              network: 'eip155:8453',
              client: {
                scheme: 'exact',
                async createPaymentPayload() {
                  return { x402Version: 2, payload: {} }
                },
              },
            },
          ],
        },
      },
      identity: {
        chainId: 'eip155:8453',
        publicClient,
      },
    })

    expect(client.identity).toBeDefined()
    expect(client.identity?.identityRegistry.address).toBe(
      ERC8004_ADDRESSES['eip155:8453'].identityRegistry,
    )
    expect(client.identity?.reputationRegistry.address).toBe(
      ERC8004_ADDRESSES['eip155:8453'].reputationRegistry,
    )
    expect(typeof client.identity?.fetchDiscovery).toBe('function')
    expect(typeof client.identity?.selectBestRelay).toBe('function')
    expect(typeof client.identity?.verifyPortalHost).toBe('function')
  })

  it('uses a separate ensClient when provided', () => {
    const chainClient = makePublicClient()
    const ensClient = makePublicClient()
    const client = createPortalClient({
      payment: {
        paidFetch: {
          schemes: [
            {
              network: 'eip155:8453',
              client: {
                scheme: 'exact',
                async createPaymentPayload() {
                  return { x402Version: 2, payload: {} }
                },
              },
            },
          ],
        },
      },
      identity: {
        chainId: 'eip155:8453',
        publicClient: chainClient,
        ensClient,
      },
    })
    expect(client.identity).toBeDefined()
    // Both clients are wired; we can't assert identity of opaque closures here,
    // but the reputationRegistry and identityRegistry were constructed using
    // chainClient (for on-chain reads), so failures in ensClient wouldn't
    // affect their address resolution.
    expect(client.identity?.identityRegistry.chainId).toBe('eip155:8453')
  })
})

describe('createPortalClient — createHonoMiddleware prebinding', () => {
  it('returns a Hono middleware with facilitator already bound', () => {
    const client = createPortalClient({
      payment: {
        paidFetch: {
          schemes: [
            {
              network: 'eip155:8453',
              client: {
                scheme: 'exact',
                async createPaymentPayload() {
                  return { x402Version: 2, payload: {} }
                },
              },
            },
          ],
        },
      },
    })

    const middleware = client.createHonoMiddleware({
      routes: {},
      schemes: [],
      syncFacilitatorOnStart: false,
    })
    expect(typeof middleware).toBe('function')
  })
})
