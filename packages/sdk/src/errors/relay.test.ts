import { describe, expect, it } from 'vitest'
import { BaseError } from './base'
import { RelayDiscoveryError, RelayVerificationError, type RelayVerifyReason } from './relay'

describe('RelayDiscoveryError', () => {
  it('stores bootstrapUrl and composes shortMessage', () => {
    const err = new RelayDiscoveryError({
      bootstrapUrl: 'https://relay.example/discovery',
    })
    expect(err.name).toBe('RelayDiscoveryError')
    expect(err.bootstrapUrl).toBe('https://relay.example/discovery')
    expect(err.shortMessage).toContain('https://relay.example/discovery')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('propagates cause via native Error.cause and walk()', () => {
    const inner = new Error('ENOTFOUND relay.example')
    const err = new RelayDiscoveryError({
      bootstrapUrl: 'https://relay.example/discovery',
      cause: inner,
    })
    expect(err.cause).toBe(inner)
    expect(err.walk()).toBe(inner)
  })
})

describe('RelayVerificationError', () => {
  it('stores host + reason and composes shortMessage', () => {
    const reason: RelayVerifyReason = 'ensip25-mismatch'
    const err = new RelayVerificationError({ host: 'relay.eth', reason })
    expect(err.name).toBe('RelayVerificationError')
    expect(err.host).toBe('relay.eth')
    expect(err.reason).toBe(reason)
    expect(err.shortMessage).toContain('relay.eth')
    expect(err.shortMessage).toContain('ensip25-mismatch')
  })

  it('supports name discriminator narrowing', () => {
    const err: BaseError = new RelayVerificationError({
      host: 'a.eth',
      reason: 'dnssec-missing',
    })
    if (err.name === 'RelayVerificationError') {
      const narrowed: 'RelayVerificationError' = err.name
      expect(narrowed).toBe('RelayVerificationError')
    } else {
      expect.fail('name discriminator did not narrow')
    }
  })
})
