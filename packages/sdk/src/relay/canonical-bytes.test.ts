import { describe, expect, it } from 'vitest'
import { relayDescriptorCanonicalBytes, relayDescriptorCanonicalJson } from './canonical-bytes'
import type { RelayDescriptor } from './discovery'

const BASE: RelayDescriptor = {
  address: '0x1234567890123456789012345678901234567890',
  version: 'v2.1.7',
  issuedAt: new Date('2026-04-19T10:00:00Z'),
  issuedAtNano: 1_776_592_800_000_000_000n,
  expiresAt: new Date('2026-04-19T11:00:00Z'),
  expiresAtNano: 1_776_596_400_000_000_000n,
  apiHttpsAddr: 'https://relay.example.com',
  wireGuardPublicKey: '',
  wireGuardPort: 0,
  supportsOverlay: false,
  supportsUdp: false,
  supportsTcp: true,
  activeConnections: 42,
  tcpBps: 1048576,
  signature: 'ignored-by-canonicalization',
}

describe('relayDescriptorCanonicalJson — Go CanonicalBytes parity', () => {
  it('emits fields in declaration order with no whitespace', () => {
    const json = relayDescriptorCanonicalJson(BASE)
    expect(json).toBe(
      '{"address":"0x1234567890123456789012345678901234567890",' +
        '"version":"v2.1.7",' +
        '"issued_at_unix_nano":1776592800000000000,' +
        '"expires_at_unix_nano":1776596400000000000,' +
        '"api_https_addr":"https://relay.example.com",' +
        '"wireguard_public_key":"",' +
        '"wireguard_port":0,' +
        '"supports_overlay":false,' +
        '"supports_udp":false,' +
        '"supports_tcp":true,' +
        '"active_connections":42,' +
        '"tcp_bps":1048576}',
    )
  })

  it('always emits every field — no omitempty', () => {
    const empty: RelayDescriptor = {
      ...BASE,
      wireGuardPublicKey: '',
      wireGuardPort: 0,
      supportsOverlay: false,
      supportsUdp: false,
      supportsTcp: false,
      activeConnections: 0,
      tcpBps: 0,
    }
    const json = relayDescriptorCanonicalJson(empty)
    expect(json).toContain('"wireguard_public_key":""')
    expect(json).toContain('"wireguard_port":0')
    expect(json).toContain('"supports_overlay":false')
    expect(json).toContain('"tcp_bps":0')
  })

  it('ignores the signature field (Go clears it before hashing)', () => {
    const a = relayDescriptorCanonicalJson({ ...BASE, signature: 'AAAA' })
    const b = relayDescriptorCanonicalJson({ ...BASE, signature: 'BBBB' })
    expect(a).toBe(b)
    expect(a).not.toContain('signature')
  })

  it('HTML-escapes < > & in strings (Go json.Marshal default)', () => {
    const tricky: RelayDescriptor = { ...BASE, apiHttpsAddr: 'https://x?a=1&b=2<ok>' }
    const json = relayDescriptorCanonicalJson(tricky)
    expect(json).toContain('\\u0026')
    expect(json).toContain('\\u003c')
    expect(json).toContain('\\u003e')
    expect(json).not.toContain('&b=2')
  })

  it('UTF-8 encodes canonical bytes', () => {
    const bytes = relayDescriptorCanonicalBytes(BASE)
    const decoded = new TextDecoder().decode(bytes)
    expect(decoded).toBe(relayDescriptorCanonicalJson(BASE))
  })
})
