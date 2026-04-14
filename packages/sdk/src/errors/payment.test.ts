import { describe, expect, it } from 'vitest'
import { BaseError } from './base'
import {
  FacilitatorError,
  PaymentRequiredError,
  type PaymentRequirements,
  VerificationError,
} from './payment'

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:8453',
  maxAmountRequired: '100000',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x0000000000000000000000000000000000000001',
  resource: 'https://api.example.com/premium',
  description: 'Premium article access',
  maxTimeoutSeconds: 60,
  outputSchema: null,
  extra: null,
}

describe('PaymentRequiredError', () => {
  it('stores requirements and composes shortMessage from them', () => {
    const err = new PaymentRequiredError({ requirements })
    expect(err.name).toBe('PaymentRequiredError')
    expect(err.requirements).toBe(requirements)
    expect(err.shortMessage).toContain('100000')
    expect(err.shortMessage).toContain(requirements.asset)
    expect(err.shortMessage).toContain('exact')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(PaymentRequiredError)
  })

  it('supports name discriminator narrowing', () => {
    const err: BaseError = new PaymentRequiredError({ requirements })
    if (err.name === 'PaymentRequiredError') {
      const narrowed: 'PaymentRequiredError' = err.name
      expect(narrowed).toBe('PaymentRequiredError')
    } else {
      expect.fail('name discriminator did not narrow')
    }
  })
})

describe('FacilitatorError', () => {
  it('stores status and body, composes shortMessage + details', () => {
    const err = new FacilitatorError({ status: 503, body: 'upstream down' })
    expect(err.name).toBe('FacilitatorError')
    expect(err.status).toBe(503)
    expect(err.body).toBe('upstream down')
    expect(err.shortMessage).toBe('Facilitator returned 503')
    expect(err.details).toBe('upstream down')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('serializes non-string body into details as JSON', () => {
    const err = new FacilitatorError({
      status: 502,
      body: { error: 'gateway' },
    })
    expect(err.details).toBe('{"error":"gateway"}')
    expect(err.body).toEqual({ error: 'gateway' })
  })

  it('does not rethrow when body throws on JSON.stringify (circular ref)', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    expect(() => new FacilitatorError({ status: 500, body: circular })).not.toThrow()
    const err = new FacilitatorError({ status: 500, body: circular })
    expect(err.details).toBe('[unserializable]')
    expect(err.body).toBe(circular)
  })
})

describe('VerificationError', () => {
  it('stores reason + invalidReason and composes shortMessage', () => {
    const err = new VerificationError({
      reason: 'invalid_signature',
      invalidReason: 'INVALID_EXACT_EVM_PAYLOAD_SIGNATURE',
    })
    expect(err.name).toBe('VerificationError')
    expect(err.reason).toBe('invalid_signature')
    expect(err.invalidReason).toBe('INVALID_EXACT_EVM_PAYLOAD_SIGNATURE')
    expect(err.shortMessage).toBe('Payment verification failed: invalid_signature')
  })

  it('omits invalidReason when not provided', () => {
    const err = new VerificationError({ reason: 'insufficient_balance' })
    expect(err.reason).toBe('insufficient_balance')
    expect(err.invalidReason).toBeUndefined()
  })
})
