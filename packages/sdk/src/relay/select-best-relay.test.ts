import { describe, expect, it } from 'vitest'
import type { RelayDescriptor } from './discovery'
import { selectBestRelay } from './select-best-relay'

const NOW = new Date('2026-04-19T10:00:00Z')
const FUTURE = new Date('2026-04-19T11:00:00Z')
const PAST = new Date('2026-04-19T09:00:00Z')

function makeRelay(overrides: Partial<RelayDescriptor>): RelayDescriptor {
  return {
    address: '0x0000000000000000000000000000000000000000',
    version: 'v2.1.7',
    issuedAt: NOW,
    issuedAtNano: BigInt(NOW.getTime()) * 1_000_000n,
    expiresAt: FUTURE,
    expiresAtNano: BigInt(FUTURE.getTime()) * 1_000_000n,
    apiHttpsAddr: 'https://relay',
    wireGuardPublicKey: '',
    wireGuardPort: 0,
    supportsOverlay: false,
    supportsUdp: false,
    supportsTcp: false,
    activeConnections: 0,
    tcpBps: 0,
    signature: '',
    ...overrides,
  }
}

describe('selectBestRelay — filtering', () => {
  it('returns null when no candidates are provided', () => {
    expect(selectBestRelay({ relays: [], now: NOW })).toBeNull()
  })

  it('excludes relays whose expiresAt is at or before now', () => {
    const expired = makeRelay({ address: '0xexpired', expiresAt: PAST })
    const atNow = makeRelay({ address: '0xatnow', expiresAt: NOW })
    const fresh = makeRelay({ address: '0xfresh', expiresAt: FUTURE })
    expect(selectBestRelay({ relays: [expired, atNow, fresh], now: NOW })?.address).toBe('0xfresh')
  })

  it('excludes banned addresses', () => {
    const a = makeRelay({ address: '0xbanned' })
    const b = makeRelay({ address: '0xok' })
    const banned = new Set(['0xbanned'])
    expect(selectBestRelay({ relays: [a, b], now: NOW, bannedAddresses: banned })?.address).toBe(
      '0xok',
    )
  })

  it('returns null when every candidate is filtered out', () => {
    const a = makeRelay({ address: '0xa', expiresAt: PAST })
    const b = makeRelay({ address: '0xb', expiresAt: PAST })
    expect(selectBestRelay({ relays: [a, b], now: NOW })).toBeNull()
  })
})

describe('selectBestRelay — scoring', () => {
  it('prefers the relay with fewer active connections', () => {
    const busy = makeRelay({ address: '0xbusy', activeConnections: 100 })
    const quiet = makeRelay({ address: '0xquiet', activeConnections: 1 })
    expect(selectBestRelay({ relays: [busy, quiet], now: NOW })?.address).toBe('0xquiet')
  })

  it('uses tcpBps as the tiebreaker when active connections are equal (higher wins)', () => {
    const slim = makeRelay({ address: '0xslim', activeConnections: 5, tcpBps: 100 })
    const fat = makeRelay({ address: '0xfat', activeConnections: 5, tcpBps: 10_000_000 })
    expect(selectBestRelay({ relays: [slim, fat], now: NOW })?.address).toBe('0xfat')
  })

  it('preserves input order as the final tiebreaker (stable sort)', () => {
    const first = makeRelay({ address: '0xfirst', activeConnections: 0, tcpBps: 0 })
    const second = makeRelay({ address: '0xsecond', activeConnections: 0, tcpBps: 0 })
    expect(selectBestRelay({ relays: [first, second], now: NOW })?.address).toBe('0xfirst')
    expect(selectBestRelay({ relays: [second, first], now: NOW })?.address).toBe('0xsecond')
  })

  it('honors a custom scoreRelay hook (lower wins)', () => {
    const a = makeRelay({ address: '0xa', activeConnections: 0 })
    const b = makeRelay({ address: '0xb', activeConnections: 1000 })
    const byInverseLoad = (r: RelayDescriptor) => -r.activeConnections
    expect(selectBestRelay({ relays: [a, b], now: NOW, scoreRelay: byInverseLoad })?.address).toBe(
      '0xb',
    )
  })
})
