/**
 * Deterministic JSON serialization of a {@link RelayDescriptor} that
 * mirrors `types.CanonicalBytes` from `gosuda/portal-tunnel@v2.1.7`
 * (file `types/identity.go`). These bytes are the payload that the
 * relay signs; any TS re-serialization that disagrees with the Go
 * output by a single byte makes signatures fail to verify.
 *
 * The Go recipe:
 *
 *   1. Project the descriptor onto a fixed anonymous struct with the
 *      fields listed below, in this exact order. `omitempty` is dropped
 *      — every field is always present, even when zero-valued.
 *   2. `json.Marshal` the struct. Go's encoder preserves declaration
 *      order, produces no whitespace, and HTML-escapes `<`, `>`, `&`
 *      in strings by default.
 *   3. The `Signature` field is NOT part of the canonical payload — it
 *      is cleared before canonicalization so that signature verification
 *      can re-derive the same bytes.
 *
 * Fields (12):
 *
 *   address, version, issued_at_unix_nano (int64), expires_at_unix_nano
 *   (int64), api_https_addr, wireguard_public_key, wireguard_port (int),
 *   supports_overlay (bool), supports_udp (bool), supports_tcp (bool),
 *   active_connections (int64), tcp_bps (float64)
 */

import type { RelayDescriptor } from './discovery'

/**
 * Return the exact bytes a Go relay signs for `descriptor`. The
 * `signature` field of the input is ignored — Go clears it before
 * computing the canonical payload, so we do the same implicitly.
 */
export function relayDescriptorCanonicalBytes(descriptor: RelayDescriptor): Uint8Array {
  const json = relayDescriptorCanonicalJson(descriptor)
  return new TextEncoder().encode(json)
}

/** Same as {@link relayDescriptorCanonicalBytes} but returns the raw JSON string. Exported for tests. */
export function relayDescriptorCanonicalJson(descriptor: RelayDescriptor): string {
  const parts = [
    `"address":${goJsonString(descriptor.address)}`,
    `"version":${goJsonString(descriptor.version)}`,
    `"issued_at_unix_nano":${descriptor.issuedAtNano.toString(10)}`,
    `"expires_at_unix_nano":${descriptor.expiresAtNano.toString(10)}`,
    `"api_https_addr":${goJsonString(descriptor.apiHttpsAddr)}`,
    `"wireguard_public_key":${goJsonString(descriptor.wireGuardPublicKey)}`,
    `"wireguard_port":${descriptor.wireGuardPort.toString(10)}`,
    `"supports_overlay":${descriptor.supportsOverlay ? 'true' : 'false'}`,
    `"supports_udp":${descriptor.supportsUdp ? 'true' : 'false'}`,
    `"supports_tcp":${descriptor.supportsTcp ? 'true' : 'false'}`,
    `"active_connections":${descriptor.activeConnections.toString(10)}`,
    `"tcp_bps":${formatFloat64(descriptor.tcpBps)}`,
  ]
  return `{${parts.join(',')}}`
}

/**
 * Emit a Go-`json.Marshal`-compatible JSON string literal. `JSON.stringify`
 * already handles standard escapes (quotes, backslash, control chars,
 * surrogate pairs); we additionally HTML-escape `<`, `>`, `&` to match
 * Go's default encoder behavior (SetEscapeHTML(true)).
 */
function goJsonString(s: string): string {
  return JSON.stringify(s)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

/**
 * Format a float64 the way Go's `json.Marshal` does (strconv.AppendFloat
 * with 'g'/-1/64). JS `Number.prototype.toString` uses the shortest
 * round-trip representation per ES2018+, which agrees with Go for the
 * values a relay advertises (non-negative TCP BPS, integers and small
 * floats). The one divergence is zero: Go emits `0`, JS emits `0`. Good.
 */
function formatFloat64(value: number): string {
  // The descriptor's tcp_bps is non-negative; we assume well-formed inputs.
  // NaN / Infinity are rejected at the zod boundary (z.number().nonnegative()).
  return value.toString()
}
