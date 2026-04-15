import type { FacilitatorClient, FacilitatorConfig } from '@x402/core/http'
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types'
import { FacilitatorError } from '../errors/payment'

const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator'
const DEFAULT_TIMEOUT_MS = 30_000
const X402_VERSION = 2

/** Retry policy applied to verify and getSupported. settle is single-shot by default. */
export type RetryPolicy = {
  count: number
  baseDelayMs: number
  capDelayMs: number
  retryableStatuses: ReadonlySet<number>
}

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

const DEFAULT_RETRY: RetryPolicy = {
  count: 2,
  baseDelayMs: 200,
  capDelayMs: 5_000,
  retryableStatuses: new Set([429, 502, 503, 504]),
}

const NO_RETRY: RetryPolicy = {
  count: 0,
  baseDelayMs: 200,
  capDelayMs: 5_000,
  retryableStatuses: new Set(),
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
    const response = await runRequest({
      url: `${url}/${path}`,
      method,
      headers,
      body,
      retry: callRetry,
      timeoutMs: opts?.timeoutMs ?? timeoutMs,
      fetchFn,
      userSignal: opts?.signal,
    })
    return (await response.json()) as T
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

function mergeRetry(base: RetryPolicy, override: Partial<RetryPolicy> | undefined): RetryPolicy {
  if (override === undefined) return base
  return {
    count: override.count ?? base.count,
    baseDelayMs: override.baseDelayMs ?? base.baseDelayMs,
    capDelayMs: override.capDelayMs ?? base.capDelayMs,
    retryableStatuses: override.retryableStatuses ?? base.retryableStatuses,
  }
}

type RunRequestArgs = {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body: string | undefined
  retry: RetryPolicy
  timeoutMs: number
  fetchFn: typeof globalThis.fetch
  userSignal: AbortSignal | undefined
}

async function runRequest(args: RunRequestArgs): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt <= args.retry.count; attempt++) {
    const internalSignal = AbortSignal.timeout(args.timeoutMs)
    const signal =
      args.userSignal !== undefined
        ? AbortSignal.any([args.userSignal, internalSignal])
        : internalSignal

    try {
      const init: RequestInit = {
        method: args.method,
        headers: args.headers,
        signal,
        redirect: 'follow',
      }
      if (args.body !== undefined) init.body = args.body
      const response = await args.fetchFn(args.url, init)

      if (response.ok) return response

      if (args.retry.retryableStatuses.has(response.status) && attempt < args.retry.count) {
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
        await sleep(retryAfterMs ?? backoffDelay(attempt, args.retry), args.userSignal)
        continue
      }

      throw new FacilitatorError({
        status: response.status,
        body: await safeReadBody(response),
      })
    } catch (err) {
      if (args.userSignal?.aborted === true) throw err
      if (err instanceof FacilitatorError) throw err

      if (isAbortError(err) && attempt < args.retry.count) {
        lastError = err
        await sleep(backoffDelay(attempt, args.retry), args.userSignal)
        continue
      }

      if (err instanceof TypeError && attempt < args.retry.count) {
        lastError = err
        await sleep(backoffDelay(attempt, args.retry), args.userSignal)
        continue
      }

      throw new FacilitatorError({
        status: 0,
        body: err instanceof Error ? err.message : String(err),
        cause: err instanceof Error ? err : undefined,
      })
    }
  }

  throw new FacilitatorError({
    status: 0,
    body: 'retries exhausted',
    cause: lastError instanceof Error ? lastError : undefined,
  })
}

function backoffDelay(attempt: number, retry: RetryPolicy): number {
  const exponential = Math.min(retry.capDelayMs, retry.baseDelayMs * 3 ** attempt)
  return Math.floor(retry.baseDelayMs + Math.random() * (exponential - retry.baseDelayMs))
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds * 1000
  const dateMs = Date.parse(value)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  return null
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } catch {
    return null
  }
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false
  return err.name === 'AbortError' || err.name === 'TimeoutError'
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError')
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
