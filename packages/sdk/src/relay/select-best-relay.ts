/**
 * Reputation-weighted relay selection from a `/discovery` response.
 *
 * portal-tunnel v2.1.7 publishes two advisory load metrics per relay —
 * `activeConnections` (lower = less busy) and `tcpBps` (higher = more TCP
 * throughput headroom). The Go-side policy engine uses a deterministic
 * MOLS-GF(64) algorithm to pick a relay; these metrics are informational.
 * We keep the TS selector deliberately simple: filter by expiry + ban
 * list, rank by active-connection count with tcpBps as the tiebreaker,
 * and expose a `scoreRelay` hook so consumers plug in ERC-8004
 * reputation, geolocation, or their own signal when needed.
 *
 * Selection is fully synchronous and stateless — the ban list is caller-
 * owned. Pair with a consumer-side `Set<string>` to track MITM detections
 * or consecutive failures across calls.
 */

import type { RelayDescriptor } from './discovery'

/** Inputs to {@link selectBestRelay}. */
export type SelectBestRelayArgs = {
  /** Candidates from a `fetchDiscovery()` response. */
  relays: readonly RelayDescriptor[]
  /** Ban list keyed by relay address. Relays whose address is in the set are skipped. */
  bannedAddresses?: ReadonlySet<string>
  /**
   * Optional scoring hook. Returns a number — **lower is better**. When
   * omitted, the default composite of `activeConnections` then `-tcpBps`
   * is used.
   */
  scoreRelay?: (relay: RelayDescriptor) => number
  /** Reference time for TTL checks. Defaults to `new Date()`. */
  now?: Date
}

/**
 * Pick the best relay from the candidate set. Returns `null` when every
 * candidate is filtered out — the caller distinguishes "no matches"
 * from "picked X" by inspecting the result, not via throws.
 *
 * @example
 * ```ts
 * const { relays } = await fetchDiscovery({ relayBaseUrl })
 * const best = selectBestRelay({
 *   relays,
 *   bannedAddresses: new Set(recentFailures),
 * })
 * if (best === null) throw new Error('no reachable relays')
 * ```
 */
export function selectBestRelay(args: SelectBestRelayArgs): RelayDescriptor | null {
  const now = args.now ?? new Date()
  const banned = args.bannedAddresses
  const scoreRelay = args.scoreRelay ?? defaultScore

  const candidates = args.relays.filter((relay) => {
    if (relay.expiresAt.getTime() <= now.getTime()) return false
    if (banned?.has(relay.address)) return false
    return true
  })

  if (candidates.length === 0) return null

  // Stable sort: input order is the final tiebreaker for equal scores,
  // so repeated calls on an unchanging discovery response pick the same
  // relay.
  const scored = candidates.map((relay, index) => ({
    relay,
    score: scoreRelay(relay),
    index,
  }))
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    return a.index - b.index
  })

  return scored[0]?.relay ?? null
}

/**
 * Default ranking: `activeConnections` first (fewer is better), then
 * `-tcpBps` so higher throughput wins the tie. Composite into a single
 * scalar via `activeConnections * 1e9 - tcpBps` so the connection count
 * dominates unless tied.
 */
function defaultScore(relay: RelayDescriptor): number {
  return relay.activeConnections * 1e9 - relay.tcpBps
}
