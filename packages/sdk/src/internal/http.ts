/**
 * Shared HTTP transport used by `/facilitator` today and `/erc8004`/`/relay`
 * in future PRs. Adds AbortSignal composition, per-attempt timeout budgets,
 * decorrelated-jitter retry, and Retry-After header handling on top of
 * `globalThis.fetch`. Internal — not re-exported from the package.
 */

/** Retry policy. `retryableStatuses` is checked before any attempt to retry. */
export type RetryPolicy = {
  count: number
  baseDelayMs: number
  capDelayMs: number
  retryableStatuses: ReadonlySet<number>
}

/** Default retry policy: 2 retries on 429/502/503/504 + transient network errors. */
export const DEFAULT_RETRY: RetryPolicy = {
  count: 2,
  baseDelayMs: 200,
  capDelayMs: 5_000,
  retryableStatuses: new Set([429, 502, 503, 504]),
}

/** No-retry policy. Used for operations where retries risk duplicate side effects (e.g. settle). */
export const NO_RETRY: RetryPolicy = {
  count: 0,
  baseDelayMs: 200,
  capDelayMs: 5_000,
  retryableStatuses: new Set(),
}

/** Merge a partial override into a base policy, keeping base defaults for unset fields. */
export function mergeRetry(
  base: RetryPolicy,
  override: Partial<RetryPolicy> | undefined,
): RetryPolicy {
  if (override === undefined) return base
  return {
    count: override.count ?? base.count,
    baseDelayMs: override.baseDelayMs ?? base.baseDelayMs,
    capDelayMs: override.capDelayMs ?? base.capDelayMs,
    retryableStatuses: override.retryableStatuses ?? base.retryableStatuses,
  }
}

/**
 * Generic HTTP failure. Subpaths translate this into their own domain error
 * (`FacilitatorError`, `RegistrationError`, etc.) at the call site so that
 * this helper stays caller-agnostic. `status = 0` indicates network error /
 * abort / retries exhausted.
 */
export class HttpRequestError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(args: { status: number; body: unknown; cause?: Error }) {
    super(
      `HTTP request failed: status=${args.status}`,
      args.cause !== undefined ? { cause: args.cause } : undefined,
    )
    this.name = 'HttpRequestError'
    this.status = args.status
    this.body = args.body
  }
}

export type RunRequestArgs = {
  url: string
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** Defaults to {@link DEFAULT_RETRY}. */
  retry?: RetryPolicy
  /** Per-attempt timeout budget in ms. Defaults to 30000. */
  timeoutMs?: number
  /** Underlying fetch. Defaults to `globalThis.fetch`. */
  fetchFn?: typeof globalThis.fetch
  /** Caller AbortSignal composed with the per-attempt timeout via `AbortSignal.any`. */
  userSignal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Execute an HTTP request with retry, timeout, and abort-signal composition.
 * Returns the `Response` on a 2xx; throws `HttpRequestError` on non-retryable
 * failures or exhausted retries. Caller abort (via `userSignal`) is re-thrown
 * unchanged so the caller can distinguish cancellation from transport failure.
 */
export async function runRequest(args: RunRequestArgs): Promise<Response> {
  const retry = args.retry ?? DEFAULT_RETRY
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchFn = args.fetchFn ?? globalThis.fetch

  let lastError: unknown

  for (let attempt = 0; attempt <= retry.count; attempt++) {
    const internalSignal = AbortSignal.timeout(timeoutMs)
    const signal =
      args.userSignal !== undefined
        ? AbortSignal.any([args.userSignal, internalSignal])
        : internalSignal

    try {
      const init: RequestInit = {
        method: args.method,
        signal,
        redirect: 'follow',
      }
      if (args.headers !== undefined) init.headers = args.headers
      if (args.body !== undefined) init.body = args.body
      const response = await fetchFn(args.url, init)

      if (response.ok) return response

      if (retry.retryableStatuses.has(response.status) && attempt < retry.count) {
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
        await sleep(retryAfterMs ?? backoffDelay(attempt, retry), args.userSignal)
        continue
      }

      throw new HttpRequestError({
        status: response.status,
        body: await safeReadBody(response),
      })
    } catch (err) {
      if (args.userSignal?.aborted === true) throw err
      if (err instanceof HttpRequestError) throw err

      if (isAbortError(err) && attempt < retry.count) {
        lastError = err
        await sleep(backoffDelay(attempt, retry), args.userSignal)
        continue
      }

      if (err instanceof TypeError && attempt < retry.count) {
        lastError = err
        await sleep(backoffDelay(attempt, retry), args.userSignal)
        continue
      }

      throw new HttpRequestError({
        status: 0,
        body: err instanceof Error ? err.message : String(err),
        ...(err instanceof Error && { cause: err }),
      })
    }
  }

  throw new HttpRequestError({
    status: 0,
    body: 'retries exhausted',
    ...(lastError instanceof Error && { cause: lastError }),
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
