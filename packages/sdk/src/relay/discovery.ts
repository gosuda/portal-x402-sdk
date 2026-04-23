/**
 * Portal-tunnel `/discovery` endpoint client.
 *
 * Mirrors `types.DiscoveryResponse` + `types.RelayDescriptor` from
 * `gosuda/portal-tunnel/types/{api,identity}.go` byte-for-byte. Wire format
 * uses snake_case JSON; we translate to camelCase at the boundary and pin
 * `protocol_version === '6'` via `types.DiscoveryVersion`. Any drift on the
 * Go side surfaces as a Zod parse failure here, not as silent garbage
 * downstream.
 *
 * The endpoint is `GET /discovery`, no auth, no params. When the relay has
 * discovery disabled, Go falls through to the default handler and returns a
 * 404 — the caller sees `RelayDiscoveryError` with status 404 in the cause
 * chain rather than a parse error.
 */

import { z } from 'zod'
import { RelayDiscoveryError } from '../errors/relay'
import { HttpRequestError, NO_RETRY, runRequest } from '../internal/http'

/** `types.DiscoveryVersion` from portal-tunnel. Pinned; bump alongside the Go constant. */
export const PORTAL_TUNNEL_DISCOVERY_VERSION = '6' as const

const DEFAULT_DISCOVERY_PATH = '/discovery'

/** Parsed `types.Identity` — embedded in every RelayDescriptor. */
export type RelayIdentity = {
  name: string
  address: string
}

/** Parsed `types.RelayDescriptor`. All 18 fields from Go, camelCased. */
export type RelayDescriptor = {
  name: string
  address: string
  relayId: string
  ownerAddress: string
  version: number
  issuedAt: Date
  expiresAt: Date
  apiHttpsAddr: string
  ingressTlsAddr: string
  wireguardPublicKey: string
  wireguardEndpoint: string
  overlayIpv4: string
  overlayCidrs: readonly string[]
  /**
   * Whether the relay participates in the public discovery mesh. Use this as
   * the first filter in {@link selectBestRelay} — a relay with
   * `discovery === false` is intentionally hidden from consumer selection.
   */
  discovery: boolean
  supportsUdp: boolean
  supportsTcp: boolean
  supportsOverlayPeer: boolean
  /** Active connection count. Lower = less loaded. */
  load: number
  /** TCP throughput (bytes per second). Lower = more headroom. */
  loadScore: number
  /** Last descriptor update as a unix millis timestamp. */
  lastUpdated: number
}

/** Parsed `types.DiscoveryResponse`. */
export type DiscoveryResponse = {
  protocolVersion: string
  generatedAt: Date
  relays: readonly RelayDescriptor[]
}

const RelayDescriptorSchema = z
  .object({
    name: z.string().default(''),
    address: z.string().default(''),
    relay_id: z.string().default(''),
    owner_address: z.string().default(''),
    version: z.number().int().nonnegative(),
    issued_at: z.string(),
    expires_at: z.string(),
    api_https_addr: z.string(),
    ingress_tls_addr: z.string().default(''),
    wireguard_public_key: z.string().default(''),
    wireguard_endpoint: z.string().default(''),
    overlay_ipv4: z.string().default(''),
    overlay_cidrs: z.array(z.string()).default([]),
    discovery: z.boolean().default(false),
    supports_udp: z.boolean().default(false),
    supports_tcp: z.boolean().default(false),
    supports_overlay_peer: z.boolean().default(false),
    load: z.number().default(0),
    load_score: z.number().default(0),
    last_updated: z.number().int().default(0),
  })
  .transform<RelayDescriptor>((raw) => ({
    name: raw.name,
    address: raw.address,
    relayId: raw.relay_id,
    ownerAddress: raw.owner_address,
    version: raw.version,
    issuedAt: new Date(raw.issued_at),
    expiresAt: new Date(raw.expires_at),
    apiHttpsAddr: raw.api_https_addr,
    ingressTlsAddr: raw.ingress_tls_addr,
    wireguardPublicKey: raw.wireguard_public_key,
    wireguardEndpoint: raw.wireguard_endpoint,
    overlayIpv4: raw.overlay_ipv4,
    overlayCidrs: raw.overlay_cidrs,
    discovery: raw.discovery,
    supportsUdp: raw.supports_udp,
    supportsTcp: raw.supports_tcp,
    supportsOverlayPeer: raw.supports_overlay_peer,
    load: raw.load,
    loadScore: raw.load_score,
    lastUpdated: raw.last_updated,
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
