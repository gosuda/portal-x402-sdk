import { BaseError, type BaseErrorParameters } from './base'

/** Reasons `portal-tunnel-siwe` can fail. */
export type PortalAuthReason = 'rate-limited' | 'request-failed'

/** Options for {@link PortalAuthError}. */
export type PortalAuthErrorArgs = {
  /** Endpoint URL that produced the failure. */
  url: string
  /** HTTP status code returned by the relay. */
  status: number
  /** Which failure mode this represents. */
  reason: PortalAuthReason
  /**
   * For `'rate-limited'`: parsed `Retry-After` header in milliseconds, if the
   * relay supplied one. `undefined` when the header was missing or unparseable.
   */
  retryAfterMs?: number
  cause?: BaseErrorParameters['cause']
  metaMessages?: BaseErrorParameters['metaMessages']
}

/**
 * Thrown when a `portal-tunnel` `/sdk/register*` request fails. `reason` lets
 * callers distinguish `'rate-limited'` (HTTP 429 — back off using
 * `retryAfterMs`) from generic `'request-failed'`.
 */
export class PortalAuthError extends BaseError {
  override readonly name = 'PortalAuthError' as const
  readonly url: string
  readonly status: number
  readonly reason: PortalAuthReason
  readonly retryAfterMs?: number

  constructor(args: PortalAuthErrorArgs) {
    super(`portal-tunnel auth failed (${args.reason}, HTTP ${args.status}) at ${args.url}`, {
      cause: args.cause,
      metaMessages: args.metaMessages,
    })
    this.url = args.url
    this.status = args.status
    this.reason = args.reason
    if (args.retryAfterMs !== undefined) this.retryAfterMs = args.retryAfterMs
  }
}

/**
 * Parse an HTTP `Retry-After` header value to milliseconds. Supports both
 * delta-seconds (`"30"`) and HTTP-date forms per RFC 7231 §7.1.3. Returns
 * `undefined` for missing, malformed, or past-dated values.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  now: () => number = Date.now,
): number | undefined {
  if (headerValue === null || headerValue === undefined || headerValue.trim() === '') {
    return undefined
  }
  const trimmed = headerValue.trim()
  if (/^-?\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10)
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
  }
  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return undefined
  const delta = dateMs - now()
  return delta > 0 ? delta : 0
}
