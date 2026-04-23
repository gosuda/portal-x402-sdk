/**
 * Portal-tunnel `/discovery` endpoint client.
 *
 * Mirrors `types.DiscoveryResponse` + `types.RelayDescriptor` from
 * `gosuda/portal-tunnel@v2.1.7` (commit `64fac11b`) byte-for-byte. Wire
 * format uses snake_case JSON; we translate to camelCase at the boundary
 * and pin `protocol_version === '7'` via `types.DiscoveryVersion`. Any
 * drift on the Go side surfaces as a Zod parse failure here, not silent
 * garbage downstream.
 *
 * The endpoint is `GET /discovery`, no auth, no params. When the relay
 * has discovery disabled, Go falls through to the default handler and
 * returns 404 — the caller sees `RelayDiscoveryError` with status 404 in
 * the cause chain rather than a parse error.
 *
 * The descriptor is 13 wire fields (post-2026-04-23 redesign):
 * `address`, `version`, `issued_at`, `expires_at`, `api_https_addr`,
 * `wireguard_public_key`, `wireguard_port`, `supports_overlay`,
 * `supports_udp`, `supports_tcp`, `active_connections`, `tcp_bps`,
 * `signature`. Everything except the first five uses Go `omitempty`, so
 * the Zod schema treats them as optional with typed defaults.
 */

import { z } from 'zod'
import { RelayDiscoveryError } from '../errors/relay'
import { HttpRequestError, NO_RETRY, runRequest } from '../internal/http'

/** `types.DiscoveryVersion` from portal-tunnel — bump alongside the Go constant. */
export const PORTAL_TUNNEL_DISCOVERY_VERSION = '7' as const

/** `types.SDKVersion` from portal-tunnel — used by `/sdk/*` endpoints (e.g. `/sdk/register`). */
export const PORTAL_TUNNEL_SDK_VERSION = '6' as const

const DEFAULT_DISCOVERY_PATH = '/discovery'

/**
 * Parsed `types.RelayDescriptor`. The `address` field is the secp256k1
 * public-key-derived EIP-55 address that signs the descriptor; see
 * `verifyRelayDescriptorSignature` for Layer 0 verification.
 *
 * `issuedAtNano` and `expiresAtNano` preserve the nanosecond precision
 * the Go side uses when computing `CanonicalBytes` (the signing payload).
 * JS `Date` truncates to millisecond precision, so we keep the raw
 * `UnixNano()` as a BigInt alongside the Date for consumer convenience.
 */
export type RelayDescriptor = {
  address: string
  version: string
  issuedAt: Date
  /** Unix nanoseconds at which the descriptor was signed. Load-bearing for signature verification. */
  issuedAtNano: bigint
  expiresAt: Date
  /** Unix nanoseconds at which the descriptor expires. Load-bearing for signature verification. */
  expiresAtNano: bigint
  apiHttpsAddr: string
  wireGuardPublicKey: string
  wireGuardPort: number
  supportsOverlay: boolean
  supportsUdp: boolean
  supportsTcp: boolean
  /** Active connection count reported by the relay. Lower = less loaded. */
  activeConnections: number
  /** TCP throughput in bytes per second. Higher = more headroom. */
  tcpBps: number
  /**
   * Base64 `StdEncoding` of the recoverable secp256k1 signature over
   * `CanonicalBytes(descriptor)` with `Signature` cleared. Empty on
   * unsigned bootstrap responses; Layer 0 verification is skipped when
   * empty.
   */
  signature: string
}

/**
 * Convert an RFC3339 / RFC3339Nano timestamp string to Unix nanoseconds.
 * Go's `time.Time.MarshalJSON` emits up to 9 fractional-second digits;
 * JS `Date` truncates at millisecond precision, so we parse the nano
 * portion manually to keep the signing payload byte-exact.
 */
export function rfc3339ToUnixNano(rfc3339: string): bigint {
  const match = rfc3339.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/,
  )
  if (match === null) {
    throw new Error(`invalid RFC3339 timestamp: ${rfc3339}`)
  }
  const base = match[1] ?? ''
  const frac = match[2]
  const tz = match[3] ?? 'Z'
  const integerSeconds = BigInt(Math.floor(new Date(`${base}${tz}`).getTime() / 1000))
  const nanos = frac === undefined ? 0n : BigInt(frac.slice(1).padEnd(9, '0').slice(0, 9))
  return integerSeconds * 1_000_000_000n + nanos
}

/** Parsed `types.DiscoveryResponse`. */
export type DiscoveryResponse = {
  protocolVersion: string
  generatedAt: Date
  relays: readonly RelayDescriptor[]
}

const RelayDescriptorSchema = z
  .object({
    address: z.string(),
    version: z.string(),
    issued_at: z.string(),
    expires_at: z.string(),
    api_https_addr: z.string(),
    wireguard_public_key: z.string().default(''),
    wireguard_port: z.number().int().min(0).max(65535).default(0),
    supports_overlay: z.boolean().default(false),
    supports_udp: z.boolean().default(false),
    supports_tcp: z.boolean().default(false),
    active_connections: z.number().int().nonnegative().default(0),
    tcp_bps: z.number().nonnegative().default(0),
    signature: z.string().default(''),
  })
  .transform<RelayDescriptor>((raw) => ({
    address: raw.address,
    version: raw.version,
    issuedAt: new Date(raw.issued_at),
    issuedAtNano: rfc3339ToUnixNano(raw.issued_at),
    expiresAt: new Date(raw.expires_at),
    expiresAtNano: rfc3339ToUnixNano(raw.expires_at),
    apiHttpsAddr: raw.api_https_addr,
    wireGuardPublicKey: raw.wireguard_public_key,
    wireGuardPort: raw.wireguard_port,
    supportsOverlay: raw.supports_overlay,
    supportsUdp: raw.supports_udp,
    supportsTcp: raw.supports_tcp,
    activeConnections: raw.active_connections,
    tcpBps: raw.tcp_bps,
    signature: raw.signature,
  }))

const DiscoveryResponseSchema = z
  .object({
    protocol_version: z.string(),
    generated_at: z.string(),
    relays: z.array(RelayDescriptorSchema),
  })
  .transform<DiscoveryResponse>((raw) => ({
    protocolVersion: raw.protocol_version,
    generatedAt: new Date(raw.generated_at),
    relays: raw.relays,
  }))

/**
 * Matches `types.RelayDescriptor.HasOverlayPeer` in Go — the relay has
 * a usable WireGuard overlay endpoint only when it advertises overlay
 * support, a non-empty public key, and a port in the valid range.
 */
export function hasOverlayPeer(relay: RelayDescriptor): boolean {
  return (
    relay.supportsOverlay &&
    relay.wireGuardPublicKey.trim() !== '' &&
    relay.wireGuardPort > 0 &&
    relay.wireGuardPort <= 65535
  )
}

/** Configuration for {@link fetchDiscovery}. */
export type FetchDiscoveryArgs = {
  /** Relay base URL. Trailing slashes are normalized. */
  relayBaseUrl: string
  /** Override the default `/discovery` path. */
  path?: string
  /** Caller AbortSignal. */
  signal?: AbortSignal
  /** Per-request timeout budget (ms). */
  timeoutMs?: number
  /** Custom fetch for tests / alternate runtimes. */
  fetch?: typeof globalThis.fetch
}

/**
 * Fetch and parse a relay's `/discovery` response.
 *
 * Rejects with {@link RelayDiscoveryError} on network failure, non-2xx
 * response, Zod parse failure, or a `protocol_version` that does not match
 * {@link PORTAL_TUNNEL_DISCOVERY_VERSION}. Caller aborts propagate unchanged.
 *
 * @example
 * ```ts
 * const result = await fetchDiscovery({ relayBaseUrl: 'https://relay.example.com' })
 * console.log(result.relays.length, 'relays advertised')
 * ```
 */
export async function fetchDiscovery(args: FetchDiscoveryArgs): Promise<DiscoveryResponse> {
  const base = args.relayBaseUrl.replace(/\/+$/, '')
  const url = `${base}${args.path ?? DEFAULT_DISCOVERY_PATH}`

  let response: Response
  try {
    response = await runRequest({
      url,
      method: 'GET',
      retry: NO_RETRY,
      ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
      ...(args.fetch !== undefined && { fetchFn: args.fetch }),
      ...(args.signal !== undefined && { userSignal: args.signal }),
    })
  } catch (err) {
    if (args.signal?.aborted === true) throw err
    throw new RelayDiscoveryError({
      bootstrapUrl: url,
      ...(err instanceof HttpRequestError && { cause: err }),
    })
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch (err) {
    throw new RelayDiscoveryError({
      bootstrapUrl: url,
      ...(err instanceof Error && { cause: err }),
      metaMessages: ['response body was not valid JSON'],
    })
  }

  const parsed = DiscoveryResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new RelayDiscoveryError({
      bootstrapUrl: url,
      cause: new Error(parsed.error.message),
      metaMessages: ['/discovery response shape did not match DiscoveryResponse'],
    })
  }

  if (parsed.data.protocolVersion !== PORTAL_TUNNEL_DISCOVERY_VERSION) {
    throw new RelayDiscoveryError({
      bootstrapUrl: url,
      metaMessages: [
        `expected protocol_version '${PORTAL_TUNNEL_DISCOVERY_VERSION}', got '${parsed.data.protocolVersion}'`,
      ],
    })
  }

  return parsed.data
}
