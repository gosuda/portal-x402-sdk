import type { PaymentPayload, PaymentRequirements, VerifyResponse } from '@x402/core/types'
import { parseSIWxHeader, verifySIWxSignature } from '@x402/extensions/sign-in-with-x'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { privateKeyToAccount } from 'viem/accounts'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createPortalFacilitator } from '../facilitator'
import { createSiwxAuthHeaders } from './auth-headers'
import { createPortalSiwx } from './portal-siwx'

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const account = privateKeyToAccount(TEST_PRIVATE_KEY)

const FACILITATOR_URL = 'https://test.facilitator.example'

const baseSiwxConfig = {
  domain: 'app.example',
  uri: 'https://app.example/portal',
} as const

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

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('createSiwxAuthHeaders — shape', () => {
  it('returns an async function matching FacilitatorConfig.createAuthHeaders', async () => {
    const siwx = createPortalSiwx(baseSiwxConfig)
    const fn = createSiwxAuthHeaders({ siwx, address: account.address, signer: account })

    expect(typeof fn).toBe('function')
    const headers = await fn()
    expect(headers).toHaveProperty('verify')
    expect(headers).toHaveProperty('settle')
    expect(headers).toHaveProperty('supported')
  })
})

describe('createSiwxAuthHeaders — scheme', () => {
  it('defaults to the SIGN-IN-WITH-X canonical header (x402 v2 spec)', async () => {
    const siwx = createPortalSiwx(baseSiwxConfig)
    const fn = createSiwxAuthHeaders({ siwx, address: account.address, signer: account })
    const headers = await fn()

    expect(headers.verify).toHaveProperty('SIGN-IN-WITH-X')
    expect(headers.verify).not.toHaveProperty('Authorization')
    expect(typeof headers.verify['SIGN-IN-WITH-X']).toBe('string')
    expect(headers.verify['SIGN-IN-WITH-X'].length).toBeGreaterThan(100)
  })

  it('emits Authorization: Bearer <base64> when scheme="bearer"', async () => {
    const siwx = createPortalSiwx(baseSiwxConfig)
    const fn = createSiwxAuthHeaders({
      siwx,
      address: account.address,
      signer: account,
      scheme: 'bearer',
    })
    const headers = await fn()

    expect(headers.verify).toHaveProperty('Authorization')
    expect(headers.verify).not.toHaveProperty('SIGN-IN-WITH-X')
    expect(headers.verify.Authorization.startsWith('Bearer ')).toBe(true)
  })

  it('produces a base64 payload that parses back to a verifiable SIWX signature', async () => {
    const siwx = createPortalSiwx(baseSiwxConfig)
    const fn = createSiwxAuthHeaders({ siwx, address: account.address, signer: account })
    const headers = await fn()

    const encoded = headers.verify['SIGN-IN-WITH-X']
    const parsed = parseSIWxHeader(encoded)

    expect(parsed.address.toLowerCase()).toBe(account.address.toLowerCase())
    expect(parsed.domain).toBe(baseSiwxConfig.domain)
    expect(parsed.uri).toBe(baseSiwxConfig.uri)

    const verified = await verifySIWxSignature(parsed)
    expect(verified.valid).toBe(true)
  })
})

describe('createSiwxAuthHeaders — freshness', () => {
  it('signs a fresh challenge on every invocation (different nonces)', async () => {
    const siwx = createPortalSiwx(baseSiwxConfig)
    const fn = createSiwxAuthHeaders({ siwx, address: account.address, signer: account })

    const a = parseSIWxHeader((await fn()).verify['SIGN-IN-WITH-X'])
    const b = parseSIWxHeader((await fn()).verify['SIGN-IN-WITH-X'])
    expect(a.nonce).not.toBe(b.nonce)
  })
})

describe('createSiwxAuthHeaders — paths', () => {
  it('attaches headers to all three paths by default', async () => {
    const siwx = createPortalSiwx(baseSiwxConfig)
    const fn = createSiwxAuthHeaders({ siwx, address: account.address, signer: account })
    const headers = await fn()

    expect(Object.keys(headers.verify).length).toBeGreaterThan(0)
    expect(Object.keys(headers.settle).length).toBeGreaterThan(0)
    expect(Object.keys(headers.supported).length).toBeGreaterThan(0)
  })

  it('excludes paths set to false, keeps the others', async () => {
    const siwx = createPortalSiwx(baseSiwxConfig)
    const fn = createSiwxAuthHeaders({
      siwx,
      address: account.address,
      signer: account,
      paths: { verify: true, settle: false, supported: true },
    })
    const headers = await fn()

    expect(Object.keys(headers.verify).length).toBeGreaterThan(0)
    expect(headers.settle).toEqual({})
    expect(Object.keys(headers.supported).length).toBeGreaterThan(0)
  })
})

describe('createSiwxAuthHeaders — createPortalFacilitator integration', () => {
  it('attaches SIGN-IN-WITH-X header on verify reaching the facilitator', async () => {
    let receivedHeader: string | null = null
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, ({ request }) => {
        receivedHeader = request.headers.get('SIGN-IN-WITH-X')
        return HttpResponse.json(verifyOk)
      }),
    )

    const siwx = createPortalSiwx(baseSiwxConfig)
    const fac = createPortalFacilitator({
      url: FACILITATOR_URL,
      createAuthHeaders: createSiwxAuthHeaders({
        siwx,
        address: account.address,
        signer: account,
      }),
    })

    await fac.verify(payloadFixture, requirementsFixture)

    expect(receivedHeader).not.toBeNull()
    expect(typeof receivedHeader).toBe('string')

    const parsed = parseSIWxHeader(receivedHeader ?? '')
    expect(parsed.address.toLowerCase()).toBe(account.address.toLowerCase())
    const verified = await verifySIWxSignature(parsed)
    expect(verified.valid).toBe(true)
  })

  it('attaches Authorization: Bearer header when scheme="bearer"', async () => {
    let receivedAuth: string | null = null
    server.use(
      http.post(`${FACILITATOR_URL}/verify`, ({ request }) => {
        receivedAuth = request.headers.get('Authorization')
        return HttpResponse.json(verifyOk)
      }),
    )

    const siwx = createPortalSiwx(baseSiwxConfig)
    const fac = createPortalFacilitator({
      url: FACILITATOR_URL,
      createAuthHeaders: createSiwxAuthHeaders({
        siwx,
        address: account.address,
        signer: account,
        scheme: 'bearer',
      }),
    })

    await fac.verify(payloadFixture, requirementsFixture)

    expect(receivedAuth).not.toBeNull()
    expect((receivedAuth ?? '').startsWith('Bearer ')).toBe(true)
  })
})
