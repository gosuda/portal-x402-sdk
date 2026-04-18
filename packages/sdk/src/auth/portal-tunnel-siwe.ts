import { type Address, getAddress, type Hex } from 'viem'
import { z } from 'zod'

/**
 * Byte-equal constants with `gosuda/portal-tunnel` — `portal/auth/auth.go:149-161`.
 * Changing any of these breaks wire compatibility with the Go relay.
 */
const PORTAL_TUNNEL_STATEMENT = 'Register a portal lease'
const PORTAL_TUNNEL_SIWE_CHAIN_ID = 1
const PORTAL_TUNNEL_SIWE_VERSION = '1'
const DEFAULT_CHALLENGE_PATH = '/sdk/register/challenge'
const DEFAULT_REGISTER_PATH = '/sdk/register'

// ────────────────────────────────────────────────────────────────────────────
// Byte-equal SIWE message builder (offline)
// ────────────────────────────────────────────────────────────────────────────

/** Inputs to reconstruct the SIWE message that portal-tunnel's Go relay builds. */
export type PortalTunnelChallengeInput = {
  /** SIWE domain (relay hostname, e.g. `'relay.example.com'`). */
  domain: string
  /** SIWE URI. Portal-tunnel's relay uses `'/sdk/register'`. */
  uri: string
  /** Consumer EOA address. Checksummed via `viem.getAddress` in the output. */
  address: Address
  /** SIWE nonce. Must be alphanumeric (EIP-4361 ABNF). */
  nonce: string
  /** Challenge ID (`rch_*` prefix per portal-tunnel). */
  requestId: string
  /** Issuance time. Rendered as RFC 3339 without milliseconds (matches Go `time.RFC3339`). */
  issuedAt: Date
  /** Expiration time (portal-tunnel: issuedAt + 2 minutes). */
  expiresAt: Date
}

/**
 * Build the SIWE message that portal-tunnel's
 * `portal/auth/auth.go:BuildRegisterChallengeMessage` produces for the same
 * inputs. Byte-equal to `spruceid/siwe-go`'s `InitMessage(...).String()`.
 */
export function buildPortalTunnelChallengeMessage(input: PortalTunnelChallengeInput): string {
  const address = getAddress(input.address)
  const issuedAt = toRFC3339NoMs(input.issuedAt)
  const expirationTime = toRFC3339NoMs(input.expiresAt)

  return (
    `${input.domain} wants you to sign in with your Ethereum account:\n` +
    `${address}\n` +
    `\n` +
    `${PORTAL_TUNNEL_STATEMENT}\n` +
    `\n` +
    `URI: ${input.uri}\n` +
    `Version: ${PORTAL_TUNNEL_SIWE_VERSION}\n` +
    `Chain ID: ${PORTAL_TUNNEL_SIWE_CHAIN_ID}\n` +
    `Nonce: ${input.nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Expiration Time: ${expirationTime}\n` +
    `Request ID: ${input.requestId}`
  )
}

function toRFC3339NoMs(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ────────────────────────────────────────────────────────────────────────────
// Lease flow (online): fetchChallenge + register over HTTP
// ────────────────────────────────────────────────────────────────────────────

/** Optional lease metadata tag set. Mirrors Go `types.LeaseMetadata`. */
export type PortalTunnelLeaseMetadata = {
  description?: string
  owner?: string
  thumbnail?: string
  tags?: string[]
  hide?: boolean
}

/** Input to `fetchChallenge`. Mirrors Go `types.RegisterChallengeRequest`. */
export type PortalTunnelChallengeRequest = {
  /** Consumer identity. Address is required; name optional. */
  identity: { name?: string; address: Address }
  metadata?: PortalTunnelLeaseMetadata
  /** Lease TTL in seconds. Relay enforces its own min/max. */
  ttl?: number
  /** Request UDP/QUIC exposure. */
  udpEnabled?: boolean
  /** Request TCP exposure. */
  tcpEnabled?: boolean
}

/** Output of `fetchChallenge`. Mirrors Go `types.RegisterChallengeResponse`. */
export type PortalTunnelChallenge = {
  challengeId: string
  /** Challenge expiration — sign + submit before this time. */
  expiresAt: Date
  /** Ready-to-sign SIWE message. Pass to `WalletClient.signMessage({ message })`. */
  siweMessage: string
}

/** Output of `register`. Mirrors Go `types.RegisterResponse`. */
export type PortalTunnelLease = {
  identity: { name: string; address: Address }
  /** Lease expiration (separate from challenge expiration). */
  expiresAt: Date
  hostname: string
  /**
   * ES256K JWT. Claims per portal-tunnel `portal/auth/auth.go`:
   * `iss` (relay name), `sub` (`name:address`), `aud` (`"portal-sdk"`),
   * `jti` (`tok_*`), `iat`/`nbf`/`exp`, `identity`.
   */
  accessToken: string
  sniPort?: number
  udpAddr?: string
  udpEnabled?: boolean
  tcpAddr?: string
  tcpEnabled?: boolean
}

/** Configuration for `createPortalTunnelLeaseFlow`. */
export type PortalTunnelLeaseConfig = {
  /** Relay base URL. Trailing slashes are normalized. */
  relayBaseUrl: string
  /** Override challenge endpoint path. Default `'/sdk/register/challenge'`. */
  challengePath?: string
  /** Override register endpoint path. Default `'/sdk/register'`. */
  registerPath?: string
  /** Custom fetch for tests or alternate runtimes. */
  fetch?: typeof globalThis.fetch
}

export interface PortalTunnelLeaseFlow {
  /** `POST /sdk/register/challenge` and parse the SIWE challenge response. */
  fetchChallenge(args: PortalTunnelChallengeRequest): Promise<PortalTunnelChallenge>
  /** `POST /sdk/register` with the signed challenge and parse the lease token. */
  register(args: {
    challengeId: string
    siweMessage: string
    siweSignature: Hex
    /** Optional consumer-reported IP (relay uses for geo/abuse controls). */
    reportedIp?: string
  }): Promise<PortalTunnelLease>
}

const ChallengeResponseSchema = z.object({
  challenge_id: z.string(),
  expires_at: z.string(),
  siwe_message: z.string(),
})

const LeaseResponseSchema = z.object({
  identity: z.object({ name: z.string(), address: z.string() }),
  expires_at: z.string(),
  hostname: z.string(),
  access_token: z.string(),
  sni_port: z.number().optional(),
  udp_addr: z.string().optional(),
  udp_enabled: z.boolean().optional(),
  tcp_addr: z.string().optional(),
  tcp_enabled: z.boolean().optional(),
})

/** Create a portal-tunnel lease registration flow client. */
export function createPortalTunnelLeaseFlow(
  config: PortalTunnelLeaseConfig,
): PortalTunnelLeaseFlow {
  const base = config.relayBaseUrl.replace(/\/+$/, '')
  const challengeUrl = `${base}${config.challengePath ?? DEFAULT_CHALLENGE_PATH}`
  const registerUrl = `${base}${config.registerPath ?? DEFAULT_REGISTER_PATH}`
  const fetchFn = config.fetch ?? globalThis.fetch

  return {
    async fetchChallenge(args) {
      const body: Record<string, unknown> = {
        identity: args.identity,
      }
      if (args.metadata !== undefined) body.metadata = args.metadata
      if (args.ttl !== undefined) body.ttl = args.ttl
      if (args.udpEnabled !== undefined) body.udp_enabled = args.udpEnabled
      if (args.tcpEnabled !== undefined) body.tcp_enabled = args.tcpEnabled

      const response = await fetchFn(challengeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        throw new Error(`portal-tunnel challenge failed: ${response.status} ${response.statusText}`)
      }
      const parsed = ChallengeResponseSchema.parse(await response.json())
      return {
        challengeId: parsed.challenge_id,
        expiresAt: new Date(parsed.expires_at),
        siweMessage: parsed.siwe_message,
      }
    },

    async register(args) {
      const body: Record<string, unknown> = {
        challenge_id: args.challengeId,
        siwe_message: args.siweMessage,
        siwe_signature: args.siweSignature,
      }
      if (args.reportedIp !== undefined) body.reported_ip = args.reportedIp

      const response = await fetchFn(registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        throw new Error(`portal-tunnel register failed: ${response.status} ${response.statusText}`)
      }
      const parsed = LeaseResponseSchema.parse(await response.json())
      const lease: PortalTunnelLease = {
        identity: {
          name: parsed.identity.name,
          address: getAddress(parsed.identity.address),
        },
        expiresAt: new Date(parsed.expires_at),
        hostname: parsed.hostname,
        accessToken: parsed.access_token,
      }
      if (parsed.sni_port !== undefined) lease.sniPort = parsed.sni_port
      if (parsed.udp_addr !== undefined) lease.udpAddr = parsed.udp_addr
      if (parsed.udp_enabled !== undefined) lease.udpEnabled = parsed.udp_enabled
      if (parsed.tcp_addr !== undefined) lease.tcpAddr = parsed.tcp_addr
      if (parsed.tcp_enabled !== undefined) lease.tcpEnabled = parsed.tcp_enabled
      return lease
    },
  }
}
