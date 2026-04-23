import type { FacilitatorClient, FacilitatorConfig } from '@x402/core/http'
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types'
import { FacilitatorError } from '../errors/payment'
import {
  DEFAULT_RETRY,
  HttpRequestError,
  mergeRetry,
  NO_RETRY,
  type RetryPolicy,
  runRequest,
} from '../internal/http'

const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator'
const DEFAULT_TIMEOUT_MS = 30_000
const X402_VERSION = 2

export type { RetryPolicy }

/** Configuration for {@link createPortalFacilitator}. */
export type PortalFacilitatorConfig = {
  /** Facilitator URL. Defaults to `https://x402.org/facilitator`. */
  url?: string
  /**
   * Per-attempt timeout in ms (each retry gets a fresh budget, total wall
   * clock can exceed this when retries are enabled). Default 30000 to cover
   * slow on-chain settle.
   */
  timeoutMs?: number
  /** Retry policy for verify and getSupported. */
  retry?: Partial<RetryPolicy>
  /** Optional async header builder, identical shape to upstream FacilitatorConfig. */
  createAuthHeaders?: FacilitatorConfig['createAuthHeaders']
  /** Custom fetch for testing or non-default environments. */
  fetch?: typeof globalThis.fetch
}

/** Per-call options accepted by every PortalFacilitator method. */
export type RequestOptions = {
  /** Caller AbortSignal. Composed with the internal per-attempt timeout via `AbortSignal.any`. */
  signal?: AbortSignal
  /** Per-attempt timeout override in ms (each retry gets a fresh budget). */
  timeoutMs?: number
  /** Per-call retry override. Pass `{ count: N }` on settle to opt INTO retry. */
  retry?: Partial<RetryPolicy>
}

/** Adds optional per-call options to the upstream FacilitatorClient contract. */
export interface PortalFacilitator extends FacilitatorClient {
  readonly url: string
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    opts?: RequestOptions,
  ): Promise<VerifyResponse>
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    opts?: RequestOptions,
  ): Promise<SettleResponse>
  getSupported(opts?: RequestOptions): Promise<SupportedResponse>
}

/** Create a Portal facilitator HTTP client with retry, timeout, and AbortSignal support. */
export function createPortalFacilitator(config: PortalFacilitatorConfig = {}): PortalFacilitator {
  const url = (config.url ?? DEFAULT_FACILITATOR_URL).replace(/\/+$/, '')
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retry = mergeRetry(DEFAULT_RETRY, config.retry)
  const fetchFn = config.fetch ?? globalThis.fetch
  const createAuthHeaders = config.createAuthHeaders

  async function buildHeaders(
    path: 'verify' | 'settle' | 'supported',
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (createAuthHeaders === undefined) return headers
    const built = await createAuthHeaders()
    return { ...headers, ...built[path] }
  }

  async function call<T>(
    path: 'verify' | 'settle' | 'supported',
    method: 'GET' | 'POST',
    body: string | undefined,
    callRetry: RetryPolicy,
    opts: RequestOptions | undefined,
  ): Promise<T> {
    const headers = await buildHeaders(path)
    try {
      const response = await runRequest({
        url: `${url}/${path}`,
        method,
        headers,
        ...(body !== undefined && { body }),
        retry: callRetry,
        timeoutMs: opts?.timeoutMs ?? timeoutMs,
        fetchFn,
        ...(opts?.signal !== undefined && { userSignal: opts.signal }),
      })
      return (await response.json()) as T
    } catch (err) {
      if (err instanceof HttpRequestError) {
        // Preserve the original cause chain — HttpRequestError is an internal
        // transport wrapper, not part of FacilitatorError's public surface.
        const cause = err.cause instanceof Error ? err.cause : undefined
        throw new FacilitatorError({
          status: err.status,
          body: err.body,
          ...(cause !== undefined && { cause }),
        })
      }
      throw err
    }
  }

  return {
    url,

    verify(payload, requirements, opts) {
      return call<VerifyResponse>(
        'verify',
        'POST',
        JSON.stringify({
          x402Version: X402_VERSION,
          paymentPayload: payload,
          paymentRequirements: requirements,
        }),
        mergeRetry(retry, opts?.retry),
        opts,
      )
    },

    settle(payload, requirements, opts) {
      return call<SettleResponse>(
        'settle',
        'POST',
        JSON.stringify({
          x402Version: X402_VERSION,
          paymentPayload: payload,
          paymentRequirements: requirements,
        }),
        opts?.retry !== undefined ? mergeRetry(retry, opts.retry) : NO_RETRY,
        opts,
      )
    },

    getSupported(opts) {
      return call<SupportedResponse>(
        'supported',
        'GET',
        undefined,
        mergeRetry(retry, opts?.retry),
        opts,
      )
    },
  }
}
