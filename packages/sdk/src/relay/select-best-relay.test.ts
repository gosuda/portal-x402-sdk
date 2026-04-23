import { describe, expect, it } from 'vitest'
import type { RelayDescriptor } from './discovery'
import { selectBestRelay } from './select-best-relay'

const NOW = new Date('2026-04-19T10:00:00Z')
const FUTURE = new Date('2026-04-19T11:00:00Z')
const PAST = new Date('2026-04-19T09:00:00Z')

function makeRelay(overrides: Partial<RelayDescriptor>): RelayDescriptor {
  return {
    name: 'relay',
    address: '0x0000000000000000000000000000000000000000',
    relayId: '',
    ownerAddress: '',
    version: 1,
    issuedAt: NOW,
    expiresAt: FUTURE,
    apiHttpsAddr: 'https://relay',
    ingressTlsAddr: '',
    wireguardPublicKey: '',
    wireguardEndpoint: '',
    overlayIpv4: '',
    overlayCidrs: [],
    discovery: true,
    supportsUdp: false,
    supportsTcp: false,
    supportsOverlayPeer: false,
    load: 0,
    loadScore: 0,
    lastUpdated: NOW.getTime(),
    ...overrides,
  }
}

describe('selectBestRelay — filtering', () => {
  it('returns null when no candidates are provided', () => {
    expect(selectBestRelay({ relays: [], now: NOW })).toBeNull()
  })

  it('excludes relays with discovery=false by default', () => {
    const a = makeRelay({ address: '0xa', discovery: false })
    const b = makeRelay({ address: '0xb', discovery: true })
    expect(selectBestRelay({ relays: [a, b], now: NOW })?.address).toBe('0xb')
  })

  it('includes discovery=false relays when requireDiscoveryFlag=false', () => {
    const a = makeRelay({ address: '0xa', discovery: false })
    expect(selectBestRelay({ relays: [a], now: NOW, requireDiscoveryFlag: false })?.address).toBe(
      '0xa',
    )
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
    const a = makeRelay({ address: '0xa', discovery: false })
    const b = makeRelay({ address: '0xb', expiresAt: PAST })
    expect(selectBestRelay({ relays: [a, b], now: NOW })).toBeNull()
  })
})

describe('selectBestRelay — scoring', () => {
  it('prefers the relay with lower load', () => {
    const busy = makeRelay({ address: '0xbusy', load: 100 })
    const quiet = makeRelay({ address: '0xquiet', load: 1 })
    expect(selectBestRelay({ relays: [busy, quiet], now: NOW })?.address).toBe('0xquiet')
  })

  it('uses loadScore as the tiebreaker when load is equal', () => {
    const hot = makeRelay({ address: '0xhot', load: 5, loadScore: 10_000 })
    const cool = makeRelay({ address: '0xcool', load: 5, loadScore: 100 })
    expect(selectBestRelay({ relays: [hot, cool], now: NOW })?.address).toBe('0xcool')
  })

  it('preserves input order as the final tiebreaker (stable sort)', () => {
    const first = makeRelay({ address: '0xfirst', load: 0, loadScore: 0 })
    const second = makeRelay({ address: '0xsecond', load: 0, loadScore: 0 })
    expect(selectBestRelay({ relays: [first, second], now: NOW })?.address).toBe('0xfirst')
    expect(selectBestRelay({ relays: [second, first], now: NOW })?.address).toBe('0xsecond')
  })

  it('honors a custom scoreRelay hook (lower wins)', () => {
    const a = makeRelay({ address: '0xa', load: 0 })
    const b = makeRelay({ address: '0xb', load: 1000 })
    const byInverseLoad = (r: RelayDescriptor) => -r.load
    expect(selectBestRelay({ relays: [a, b], now: NOW, scoreRelay: byInverseLoad })?.address).toBe(
      '0xb',
    )
  })
})
