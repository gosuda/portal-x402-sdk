import { describe, expect, it } from 'vitest'
import { BaseError } from './base'
import { IdentityLookupError, RegistrationError, type RegistrationStep } from './identity'
import {
  FacilitatorError,
  PaymentRequiredError,
  type PaymentRequirements,
  VerificationError,
} from './payment'
import { RelayDiscoveryError, RelayVerificationError } from './relay'

describe('IdentityLookupError', () => {
  it('stores agentId when provided and composes shortMessage', () => {
    const err = new IdentityLookupError({ agentId: 42n })
    expect(err.name).toBe('IdentityLookupError')
    expect(err.agentId).toBe(42n)
    expect(err.address).toBeUndefined()
    expect(err.shortMessage).toContain('42')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('prefers agentId over address in shortMessage when both present', () => {
    const err = new IdentityLookupError({
      agentId: 7n,
      address: '0x0000000000000000000000000000000000000001',
    })
    expect(err.agentId).toBe(7n)
    expect(err.address).toBe('0x0000000000000000000000000000000000000001')
    expect(err.shortMessage).toContain('7')
  })
})

describe('RegistrationError', () => {
  it('stores step, shortMessage, and chains cause', () => {
    const step: RegistrationStep = 'ipfs'
    const inner = new Error('pin failed')
    const err = new RegistrationError({ step, cause: inner })
    expect(err.name).toBe('RegistrationError')
    expect(err.step).toBe('ipfs')
    expect(err.shortMessage).toBe('Registration failed at step: ipfs')
    expect(err.cause).toBe(inner)
  })

  it('supports name discriminator narrowing', () => {
    const err: BaseError = new RegistrationError({ step: 'receipt' })
    if (err.name === 'RegistrationError') {
      const narrowed: 'RegistrationError' = err.name
      expect(narrowed).toBe('RegistrationError')
    } else {
      expect.fail('name discriminator did not narrow')
    }
  })
})

describe('PortalErrorName discriminator exhaustiveness', () => {
  type AnyPortalSubclassError =
    | PaymentRequiredError
    | FacilitatorError
    | VerificationError
    | RelayDiscoveryError
    | RelayVerificationError
    | IdentityLookupError
    | RegistrationError

  function tag(err: AnyPortalSubclassError): string {
    switch (err.name) {
      case 'PaymentRequiredError':
        return 'payment-required'
      case 'FacilitatorError':
        return 'facilitator'
      case 'VerificationError':
        return 'verification'
      case 'RelayDiscoveryError':
        return 'relay-discovery'
      case 'RelayVerificationError':
        return 'relay-verification'
      case 'IdentityLookupError':
        return 'identity-lookup'
      case 'RegistrationError':
        return 'registration'
      default: {
        const _exhaustive: never = err
        return _exhaustive
      }
    }
  }

  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'eip155:8453',
    maxAmountRequired: '1',
    asset: '0x0000000000000000000000000000000000000000',
    payTo: '0x0000000000000000000000000000000000000001',
    resource: 'https://x',
    description: '',
    maxTimeoutSeconds: 60,
    outputSchema: null,
    extra: null,
  }

  it('narrows every subclass via err.name in a single switch', () => {
    const samples: Array<[AnyPortalSubclassError, string]> = [
      [new PaymentRequiredError({ requirements }), 'payment-required'],
      [new FacilitatorError({ status: 503, body: 'down' }), 'facilitator'],
      [new VerificationError({ reason: 'invalid_signature' }), 'verification'],
      [new RelayDiscoveryError({ bootstrapUrl: 'https://x/discovery' }), 'relay-discovery'],
      [new RelayVerificationError({ host: 'r.eth', reason: 'ens-mismatch' }), 'relay-verification'],
      [new IdentityLookupError({ agentId: 1n }), 'identity-lookup'],
      [new RegistrationError({ step: 'ipfs' }), 'registration'],
    ]
    for (const [err, expected] of samples) {
      expect(tag(err)).toBe(expected)
    }
  })
})
