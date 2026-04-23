import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_RETRY, HttpRequestError, mergeRetry, NO_RETRY, runRequest } from './http'

const BASE = 'https://transport.test'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('mergeRetry', () => {
  it('returns base unchanged when override is undefined', () => {
    expect(mergeRetry(DEFAULT_RETRY, undefined)).toBe(DEFAULT_RETRY)
  })

  it('applies partial overrides on top of base', () => {
    const merged = mergeRetry(DEFAULT_RETRY, { count: 5 })
    expect(merged.count).toBe(5)
    expect(merged.baseDelayMs).toBe(DEFAULT_RETRY.baseDelayMs)
    expect(merged.retryableStatuses).toBe(DEFAULT_RETRY.retryableStatuses)
  })
})

describe('runRequest — success paths', () => {
  it('returns the response for 2xx', async () => {
    server.use(http.get(`${BASE}/ok`, () => HttpResponse.json({ ok: true })))
    const res = await runRequest({ url: `${BASE}/ok`, method: 'GET' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('forwards headers and body on POST', async () => {
    let received: { auth: string | null; body: string } = { auth: null, body: '' }
    server.use(
      http.post(`${BASE}/echo`, async ({ request }) => {
        received = { auth: request.headers.get('Authorization'), body: await request.text() }
        return HttpResponse.json({})
      }),
    )

    await runRequest({
      url: `${BASE}/echo`,
      method: 'POST',
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
      body: '{"x":1}',
    })
    expect(received.auth).toBe('Bearer abc')
    expect(received.body).toBe('{"x":1}')
  })
})

describe('runRequest — HttpRequestError', () => {
  it('throws on non-retryable 4xx with parsed JSON body', async () => {
    server.use(
      http.get(`${BASE}/bad`, () => HttpResponse.json({ code: 'invalid' }, { status: 400 })),
    )
    await expect(runRequest({ url: `${BASE}/bad`, method: 'GET' })).rejects.toMatchObject({
      status: 400,
      body: { code: 'invalid' },
    })
  })

  it('captures plain-text body when JSON parse fails', async () => {
    server.use(http.get(`${BASE}/plain`, () => new HttpResponse('nope', { status: 418 })))
    await expect(runRequest({ url: `${BASE}/plain`, method: 'GET' })).rejects.toMatchObject({
      status: 418,
      body: 'nope',
    })
  })

  it('reports status 0 and chains the original error on network failure with NO_RETRY', async () => {
    server.use(http.get(`${BASE}/net`, () => HttpResponse.error()))
    try {
      await runRequest({ url: `${BASE}/net`, method: 'GET', retry: NO_RETRY })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpRequestError)
      if (err instanceof HttpRequestError) {
        expect(err.status).toBe(0)
        expect(err.cause).toBeInstanceOf(TypeError)
      }
    }
  })
})

describe('runRequest — retry', () => {
  it('retries on 503 then succeeds', async () => {
    let attempts = 0
    server.use(
      http.get(`${BASE}/flaky`, () => {
        attempts += 1
        if (attempts < 2) return new HttpResponse(null, { status: 503 })
        return HttpResponse.json({ ok: true })
      }),
    )

    const res = await runRequest({
      url: `${BASE}/flaky`,
      method: 'GET',
      retry: { ...DEFAULT_RETRY, baseDelayMs: 1, capDelayMs: 2 },
    })
    expect(res.status).toBe(200)
    expect(attempts).toBe(2)
  })

  it('honors Retry-After (seconds) before the next attempt', async () => {
    let attempts = 0
    let firstAttemptAt = 0
    let secondAttemptAt = 0
    server.use(
      http.get(`${BASE}/rateLimited`, () => {
        attempts += 1
        if (attempts === 1) {
          firstAttemptAt = Date.now()
          return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '0' } })
        }
        secondAttemptAt = Date.now()
        return HttpResponse.json({ ok: true })
      }),
    )

    await runRequest({ url: `${BASE}/rateLimited`, method: 'GET' })
    expect(attempts).toBe(2)
    expect(secondAttemptAt).toBeGreaterThanOrEqual(firstAttemptAt)
  })

  it('throws HttpRequestError with status 0 and cause after retries exhausted', async () => {
    server.use(http.get(`${BASE}/dead`, () => HttpResponse.error()))
    try {
      await runRequest({
        url: `${BASE}/dead`,
        method: 'GET',
        retry: { count: 1, baseDelayMs: 1, capDelayMs: 2, retryableStatuses: new Set() },
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpRequestError)
      if (err instanceof HttpRequestError) {
        expect(err.status).toBe(0)
        expect(err.cause).toBeInstanceOf(TypeError)
      }
    }
  })
})

describe('runRequest — abort', () => {
  it('re-throws the caller abort unchanged (no HttpRequestError wrapping)', async () => {
    server.use(
      http.get(`${BASE}/slow`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return HttpResponse.json({})
      }),
    )
    const controller = new AbortController()
    queueMicrotask(() => controller.abort())
    await expect(
      runRequest({ url: `${BASE}/slow`, method: 'GET', userSignal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
