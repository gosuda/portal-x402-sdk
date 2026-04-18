import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from '@x402/core/http'
import type {
  PaymentPayloadResult,
  PaymentRequired,
  PaymentRequirements,
  SchemeNetworkClient,
} from '@x402/core/types'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPortalPaidFetch } from './paid-fetch'

const API_BASE = 'https://api.example.test'

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '100000',
  payTo: '0x0000000000000000000000000000000000000001',
  maxTimeoutSeconds: 60,
  extra: {},
}
const paymentRequired: PaymentRequired = {
  x402Version: 2,
  resource: { url: `${API_BASE}/paid` },
  accepts: [requirements],
}

/**
 * Minimal scheme client that returns a canned payload without touching a chain
 * or a wallet. Lets us exercise the full 402 → pay → 200 roundtrip with msw
 * alone, independently of any EVM signer wiring.
 */
function createStubScheme(payloadMarker: string): SchemeNetworkClient {
  return {
    scheme: 'exact',
    async createPaymentPayload(
      x402Version: number,
      _req: PaymentRequirements,
    ): Promise<PaymentPayloadResult> {
      return { x402Version, payload: { marker: payloadMarker } }
    },
  }
}

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('createPortalPaidFetch — config', () => {
  it('returns a fetch-compatible function', () => {
    const paidFetch = createPortalPaidFetch({
      schemes: [{ network: 'eip155:8453', client: createStubScheme('shape') }],
    })
    expect(typeof paidFetch).toBe('function')
  })

  it('throws when neither signer nor schemes is provided', () => {
    expect(() => createPortalPaidFetch({})).toThrow(/signer.*schemes/i)
  })

  it('accepts a schemes-only config (no signer)', () => {
    expect(() =>
      createPortalPaidFetch({
        schemes: [{ network: 'solana:mainnet', client: createStubScheme('solana') }],
      }),
    ).not.toThrow()
  })
})

describe('createPortalPaidFetch — 402 auto-pay roundtrip', () => {
  it('retries with the v2 PAYMENT-SIGNATURE header after a 402 and returns the 200 response', async () => {
    let attempts = 0
    let receivedPaymentHeader: string | null = null

    server.use(
      http.get(`${API_BASE}/paid`, ({ request }) => {
        attempts += 1
        const payment = request.headers.get('PAYMENT-SIGNATURE')
        if (payment === null) {
          return new HttpResponse(null, {
            status: 402,
            headers: {
              'PAYMENT-REQUIRED': encodePaymentRequiredHeader(paymentRequired),
            },
          })
        }
        receivedPaymentHeader = payment
        return HttpResponse.json({ ok: true })
      }),
    )

    const paidFetch = createPortalPaidFetch({
      schemes: [{ network: 'eip155:8453', client: createStubScheme('roundtrip') }],
    })

    const res = await paidFetch(`${API_BASE}/paid`)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    expect(attempts).toBe(2)
    expect(receivedPaymentHeader).not.toBeNull()

    const decoded = decodePaymentSignatureHeader(receivedPaymentHeader ?? '')
    expect(decoded.x402Version).toBe(2)
    expect(decoded.accepted).toEqual(requirements)
    expect(decoded.payload).toEqual({ marker: 'roundtrip' })
  })

  it('passes non-402 responses straight through', async () => {
    server.use(http.get(`${API_BASE}/public`, () => HttpResponse.json({ public: true })))

    const paidFetch = createPortalPaidFetch({
      schemes: [{ network: 'eip155:8453', client: createStubScheme('passthrough') }],
    })

    const res = await paidFetch(`${API_BASE}/public`)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ public: true })
  })
})

describe('createPortalPaidFetch — fetch injection', () => {
  it('uses the provided fetch instead of globalThis.fetch', async () => {
    server.use(http.get(`${API_BASE}/ping`, () => HttpResponse.json({ pong: true })))

    const spy = vi.fn(globalThis.fetch)
    const paidFetch = createPortalPaidFetch({
      schemes: [{ network: 'eip155:8453', client: createStubScheme('fetch-injection') }],
      fetch: spy,
    })

    await paidFetch(`${API_BASE}/ping`)
    expect(spy).toHaveBeenCalledOnce()
  })
})
