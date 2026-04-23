/**
 * Reputation-weighted relay selection from a `/discovery` response.
 *
 * The Go side publishes two operational metrics per relay — `load` (active
 * connection count) and `loadScore` (TCP bytes-per-second) — plus a `discovery`
 * visibility flag and `expiresAt` TTL. This function filters by reachability
 * (publicly discoverable + not expired + not in the caller's ban list), then
 * ranks the survivors by composite score (lower `load` first, then lower
 * `loadScore` as a tiebreaker). A plug-in `scoreRelay` hook lets consumers
 * override the ranking when they care about a different trait (e.g.
 * ERC-8004 reputation score, geographic proximity).
 *
 * Selection is fully synchronous and stateless — the ban list is
 * caller-owned. Pair with a consumer-side `Set<string>` to track MITM
 * detections / consecutive failures across calls.
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
   * omitted, the default composite of `load` then `loadScore` is used.
   * Consumers plug this to weight by ERC-8004 reputation, geolocation, etc.
   */
  scoreRelay?: (relay: RelayDescriptor) => number
  /** Reference time for TTL checks. Defaults to `new Date()`. */
  now?: Date
  /**
   * Require `discovery === true`. Default `true`. Disable only when the caller
   * already narrowed the candidate set (e.g. a static bootstrap list).
   */
  requireDiscoveryFlag?: boolean
}

/**
 * Pick the best relay from the candidate set. Returns `null` when every
 * candidate is filtered out — the caller distinguishes "no matches" from
 * "picked X" by inspecting the result, not via throws.
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
  const requireDiscoveryFlag = args.requireDiscoveryFlag ?? true
  const banned = args.bannedAddresses
  const scoreRelay = args.scoreRelay ?? defaultScore

  const candidates = args.relays.filter((relay) => {
    if (requireDiscoveryFlag && !relay.discovery) return false
    if (relay.expiresAt.getTime() <= now.getTime()) return false
    if (banned?.has(relay.address)) return false
    return true
  })

  if (candidates.length === 0) return null

  // Stable sort: the input order is the tiebreaker for equal scores, so
  // repeated calls on an unchanging discovery response pick the same relay.
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
 * Default ranking: `load` first (fewer active connections is better), then
 * `loadScore` (more TCP headroom is better). Composite into a single scalar
 * via `load * 1_000_000 + loadScore` so `load` dominates; ties on `load`
 * fall through to `loadScore`.
 */
function defaultScore(relay: RelayDescriptor): number {
  return relay.load * 1_000_000 + relay.loadScore
}
