import { FacilitatorResponseError } from '@x402/core/http'
import type { FacilitatorClient } from '@x402/core/server'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { FacilitatorError } from '../errors'
import { createPortalHonoMiddleware, mapFailureToPortalError } from './middleware'

const mockFacilitator: FacilitatorClient = {
  url: 'https://mock.facilitator.example',
  async verify() {
    return { isValid: true }
  },
  async settle() {
    return {
      success: true,
      transaction: '0xdeadbeef',
      network: 'eip155:8453',
    }
  },
  async getSupported() {
    return { kinds: [], extensions: [], signers: {} }
  },
}

describe('mapFailureToPortalError', () => {
  it('returns null for an unrelated Error (caller lets it propagate)', () => {
    const result = mapFailureToPortalError(new Error('something else'))
    expect(result).toBeNull()
  })

  it('returns null for an existing FacilitatorError (no double-wrap)', () => {
    const existing = new FacilitatorError({
      status: 503,
      body: 'upstream down',
    })
    const result = mapFailureToPortalError(existing)
    expect(result).toBeNull()
  })

  it('wraps FacilitatorResponseError into a FacilitatorError', () => {
    const upstream = new FacilitatorResponseError('malformed verify response body')
    const result = mapFailureToPortalError(upstream)

    expect(result).toBeInstanceOf(FacilitatorError)
    expect(result?.status).toBe(0)
    expect(result?.body).toBe('malformed verify response body')
  })

  it('preserves the original FacilitatorResponseError on cause for downstream debugging', () => {
    const upstream = new FacilitatorResponseError('bad wire shape')
    const result = mapFailureToPortalError(upstream)

    expect(result?.cause).toBe(upstream)
    // walk() should reach the upstream error
    expect(result?.walk()).toBe(upstream)
  })
})

describe('createPortalHonoMiddleware', () => {
  it('returns a MiddlewareHandler function', () => {
    const middleware = createPortalHonoMiddleware({
      routes: {},
      facilitator: mockFacilitator,
      schemes: [],
      syncFacilitatorOnStart: false,
    })
    expect(typeof middleware).toBe('function')
  })

  it('accepts trust.verifyHost=true without throwing (placeholder in v0)', () => {
    expect(() =>
      createPortalHonoMiddleware({
        routes: {},
        facilitator: mockFacilitator,
        schemes: [],
        trust: { verifyHost: true },
        syncFacilitatorOnStart: false,
      }),
    ).not.toThrow()
  })

  it('integrates cleanly with a Hono app — unprotected routes still respond 200', async () => {
    const app = new Hono()
    app.use(
      createPortalHonoMiddleware({
        routes: {},
        facilitator: mockFacilitator,
        schemes: [],
        syncFacilitatorOnStart: false,
      }),
    )
    app.get('/public', (c) => c.text('hello'))

    const res = await app.request('/public')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
  })
})
