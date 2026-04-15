import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types'
import { delay, HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { FacilitatorError } from '../errors/payment'
import { createPortalFacilitator } from './client'

const FACILITATOR_URL = 'https://test.facilitator.example'

const requirementsFixture: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '100000',
  payTo: '0x0000000000000000000000000000000000000001',
  maxTimeoutSeconds: 60,
  extra: {},
}

const payloadFixture: PaymentPayload = {
  x402Version: 2,
  accepted: requirementsFixture,
  payload: {},
}

const verifyOk: VerifyResponse = { isValid: true }

const settleOk: SettleResponse = {
  success: true,
  transaction: '0xdeadbeef',
  network: 'eip155:8453',
}

const supportedOk: SupportedResponse = {
  kinds: [],
  extensions: [],
  signers: {},
}

const FAST_RETRY = { baseDelayMs: 1, capDelayMs: 2 } as const

const server = setupServer()

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})
afterEach(() => {
  server.resetHandlers()
})
afterAll(() => {
  server.close()
})

describe('createPortalFacilitator — happy paths', () => {
  it('verify 200 returns parsed VerifyResponse', async () => {
    server.use(http.post(`${FACILITATOR_URL}/verify`, () => HttpResponse.json(verifyOk)))
    const fac = createPortalFacilitator({ url: FACILITATOR_URL })
    const result = await fac.verify(payloadFixture, requirementsFixture)
    expect(result).toEqual(verifyOk)
  })

  it('settle 200 returns parsed SettleResponse', async () => {
    server.use(http.post(`${FACILITATOR_URL}/settle`, () => HttpResponse.json(settleOk)))
    const fac = createPortalFacilitator({ url: FACILITATOR_URL })
    const result = await fac.settle(payloadFixture, requirementsFixture)
    expect(result).toEqual(settleOk)
  })

  it('getSupported 200 returns parsed SupportedResponse', async () => {
    server.use(http.get(`${FACILITATOR_URL}/supported`, () => HttpResponse.json(supportedOk)))
    const fac = createPortalFacilitator({ url: FACILITATOR_URL })
    const result = await fac.getSupported()
    expect(result).toEqual(supportedOk)
  })
})

describe('createPortalFacilitator — error paths', () => {
  it('verify 4xx throws FacilitatorError immediately, no retry', async () => {
    let attempt = 0
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, () => {
        attempt++
        return HttpResponse.json({ error: 'bad payload' }, { status: 400 })
      }),
    )
    const fac = createPortalFacilitator({ url: FACILITATOR_URL, retry: FAST_RETRY })
    await expect(fac.verify(payloadFixture, requirementsFixture)).rejects.toBeInstanceOf(
      FacilitatorError,
    )
    expect(attempt).toBe(1)
  })

  it('verify 503 then 503 then 200 succeeds after retries', async () => {
    let attempt = 0
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, () => {
        attempt++
        if (attempt < 3) return HttpResponse.json({}, { status: 503 })
        return HttpResponse.json(verifyOk)
      }),
    )
    const fac = createPortalFacilitator({ url: FACILITATOR_URL, retry: FAST_RETRY })
    const result = await fac.verify(payloadFixture, requirementsFixture)
    expect(result).toEqual(verifyOk)
    expect(attempt).toBe(3)
  })

  it('verify 503 always exhausts retries and throws FacilitatorError', async () => {
    let attempt = 0
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, () => {
        attempt++
        return HttpResponse.json({ msg: 'down' }, { status: 503 })
      }),
    )
    const fac = createPortalFacilitator({ url: FACILITATOR_URL, retry: FAST_RETRY })
    try {
      await fac.verify(payloadFixture, requirementsFixture)
      expect.fail('expected FacilitatorError to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(FacilitatorError)
      if (err instanceof FacilitatorError) {
        expect(err.status).toBe(503)
      }
    }
    expect(attempt).toBe(3)
  })

  it('verify 429 with Retry-After: 0 honors header and succeeds on retry', async () => {
    let attempt = 0
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, () => {
        attempt++
        if (attempt === 1) {
          return HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '0' } })
        }
        return HttpResponse.json(verifyOk)
      }),
    )
    const fac = createPortalFacilitator({ url: FACILITATOR_URL, retry: FAST_RETRY })
    const result = await fac.verify(payloadFixture, requirementsFixture)
    expect(result).toEqual(verifyOk)
    expect(attempt).toBe(2)
  })

  it('verify network TypeError (HttpResponse.error) recovers on retry', async () => {
    let attempt = 0
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, () => {
        attempt++
        if (attempt === 1) return HttpResponse.error()
        return HttpResponse.json(verifyOk)
      }),
    )
    const fac = createPortalFacilitator({ url: FACILITATOR_URL, retry: FAST_RETRY })
    const result = await fac.verify(payloadFixture, requirementsFixture)
    expect(result).toEqual(verifyOk)
    expect(attempt).toBe(2)
  })
})

describe('createPortalFacilitator — abort and timeout', () => {
  it('verify propagates AbortError when user signal aborts mid-flight', async () => {
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, async () => {
        await delay(500)
        return HttpResponse.json(verifyOk)
      }),
    )
    const fac = createPortalFacilitator({ url: FACILITATOR_URL, retry: FAST_RETRY })
    const controller = new AbortController()
    const promise = fac.verify(payloadFixture, requirementsFixture, {
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('verify per-call timeoutMs fires internal timeout and recovers on retry', async () => {
    let attempt = 0
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, async () => {
        attempt++
        if (attempt === 1) {
          await delay(200)
          return HttpResponse.json(verifyOk)
        }
        return HttpResponse.json(verifyOk)
      }),
    )
    const fac = createPortalFacilitator({ url: FACILITATOR_URL, retry: FAST_RETRY })
    const result = await fac.verify(payloadFixture, requirementsFixture, {
      timeoutMs: 50,
    })
    expect(result).toEqual(verifyOk)
    expect(attempt).toBeGreaterThanOrEqual(2)
  })
})

describe('createPortalFacilitator — settle retry safety', () => {
  it('settle 503 does NOT retry by default and throws on first attempt', async () => {
    let attempt = 0
    server.use(
      http.post(`${FACILITATOR_URL}/settle`, () => {
        attempt++
        return HttpResponse.json({}, { status: 503 })
      }),
    )
    const fac = createPortalFacilitator({ url: FACILITATOR_URL, retry: FAST_RETRY })
    await expect(fac.settle(payloadFixture, requirementsFixture)).rejects.toBeInstanceOf(
      FacilitatorError,
    )
    expect(attempt).toBe(1)
  })

  it('settle 503 with explicit retry: { count: 1 } DOES retry and succeeds', async () => {
    let attempt = 0
    server.use(
      http.post(`${FACILITATOR_URL}/settle`, () => {
        attempt++
        if (attempt === 1) return HttpResponse.json({}, { status: 503 })
        return HttpResponse.json(settleOk)
      }),
    )
    const fac = createPortalFacilitator({ url: FACILITATOR_URL, retry: FAST_RETRY })
    const result = await fac.settle(payloadFixture, requirementsFixture, {
      retry: { count: 1 },
    })
    expect(result).toEqual(settleOk)
    expect(attempt).toBe(2)
  })
})

describe('createPortalFacilitator — auth and pass-through', () => {
  it('createAuthHeaders is forwarded into the verify request', async () => {
    let receivedAuth: string | null = null
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, ({ request }) => {
        receivedAuth = request.headers.get('Authorization')
        return HttpResponse.json(verifyOk)
      }),
    )
    const fac = createPortalFacilitator({
      url: FACILITATOR_URL,
      createAuthHeaders: async () => ({
        verify: { Authorization: 'Bearer test-token' },
        settle: {},
        supported: {},
      }),
    })
    await fac.verify(payloadFixture, requirementsFixture)
    expect(receivedAuth).toBe('Bearer test-token')
  })

  it('multi-chain network value passes through unchanged (no whitelist)', async () => {
    let receivedBody: unknown = null
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json(verifyOk)
      }),
    )
    const solanaRequirements: PaymentRequirements = {
      scheme: 'exact',
      network: 'solana:mainnet',
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '1000000',
      payTo: '11111111111111111111111111111111',
      maxTimeoutSeconds: 60,
      extra: {},
    }
    const solanaPayload: PaymentPayload = {
      x402Version: 2,
      accepted: solanaRequirements,
      payload: {},
    }
    const fac = createPortalFacilitator({ url: FACILITATOR_URL })
    await fac.verify(solanaPayload, solanaRequirements)
    expect(receivedBody).toMatchObject({
      paymentRequirements: { network: 'solana:mainnet' },
    })
  })
})
