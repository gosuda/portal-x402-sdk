import { describe, expect, it } from 'vitest'
import { PortalAuthError, parseRetryAfterMs } from './auth'

describe('PortalAuthError', () => {
  it('exposes literal name + reason + status + url', () => {
    const err = new PortalAuthError({
      url: 'https://relay.example.com/sdk/register/challenge',
      status: 429,
      reason: 'rate-limited',
      retryAfterMs: 30_000,
    })
    expect(err.name).toBe('PortalAuthError')
    expect(err.reason).toBe('rate-limited')
    expect(err.status).toBe(429)
    expect(err.url).toBe('https://relay.example.com/sdk/register/challenge')
    expect(err.retryAfterMs).toBe(30_000)
    expect(err.shortMessage).toContain('rate-limited')
    expect(err.shortMessage).toContain('429')
  })

  it('omits retryAfterMs when not provided', () => {
    const err = new PortalAuthError({
      url: 'https://relay.example.com/sdk/register',
      status: 401,
      reason: 'request-failed',
    })
    expect(err.retryAfterMs).toBeUndefined()
  })
})

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds form to milliseconds', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000)
    expect(parseRetryAfterMs('0')).toBe(0)
    expect(parseRetryAfterMs('   12  ')).toBe(12_000)
  })

  it('parses HTTP-date form to a positive delta from now', () => {
    const fixedNow = Date.parse('2026-04-30T10:00:00Z')
    const ms = parseRetryAfterMs('Thu, 30 Apr 2026 10:00:30 GMT', () => fixedNow)
    expect(ms).toBe(30_000)
  })

  it('clamps past HTTP-dates to 0 (do not retry in the past)', () => {
    const fixedNow = Date.parse('2026-04-30T10:00:00Z')
    expect(parseRetryAfterMs('Thu, 30 Apr 2026 09:59:00 GMT', () => fixedNow)).toBe(0)
  })

  it('returns undefined for missing / blank / malformed input', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined()
    expect(parseRetryAfterMs(undefined)).toBeUndefined()
    expect(parseRetryAfterMs('')).toBeUndefined()
    expect(parseRetryAfterMs('   ')).toBeUndefined()
    expect(parseRetryAfterMs('not-a-number-or-date')).toBeUndefined()
  })

  it('returns undefined for negative seconds (RFC says non-negative)', () => {
    expect(parseRetryAfterMs('-5')).toBeUndefined()
  })
})
