/**
 * IPFS pinning hook.
 *
 * The SDK is deliberately pinning-transport-agnostic: consumers plug in
 * Pinata, Helia, Kubo (via HTTP), Storacha, Filebase, a Portal-hosted
 * endpoint, or anything else by providing a plain function `(bytes) =>
 * Promise<{ cid }>`. Shipping no hosted-provider adapter keeps the SDK zero-
 * vendor-coupling and the /erc8004 bundle small; the helper below adds only
 * AbortSignal + timeout wiring around the consumer's pinner.
 */

import { RegistrationError } from '../errors/identity'
import type { RegistrationFile } from './registration-file'

/**
 * A consumer-provided pinning transport. Receives UTF-8 bytes of the
 * registration file JSON, returns the CID it was pinned under.
 *
 * @example Pinata
 * ```ts
 * const pin: IpfsPinner = async (bytes) => {
 *   const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` },
 *     body: bytes,
 *   })
 *   const { IpfsHash } = await res.json()
 *   return { cid: IpfsHash }
 * }
 * ```
 *
 * @example Kubo (local daemon)
 * ```ts
 * const pin: IpfsPinner = async (bytes) => {
 *   const form = new FormData()
 *   form.set('file', new Blob([bytes]))
 *   const res = await fetch('http://127.0.0.1:5001/api/v0/add', { method: 'POST', body: form })
 *   const { Hash } = await res.json()
 *   return { cid: Hash }
 * }
 * ```
 */
export type IpfsPinner = (bytes: Uint8Array) => Promise<{ cid: string }>

/** Options for {@link pinRegistrationFile}. */
export type PinRegistrationFileOptions = {
  /** Caller AbortSignal. Composed with the internal timeout via `AbortSignal.any`. */
  signal?: AbortSignal
  /** Maximum wall-clock budget in ms. No default (pinner decides). */
  timeoutMs?: number
}

/**
 * Serialize a `RegistrationFile` to JSON bytes, apply the consumer's pinner,
 * and return the resulting CID. Any pinner error wraps into
 * {@link RegistrationError} with `step: 'ipfs'`. Aborts are re-thrown
 * unchanged so the caller can distinguish cancellation from transport failure.
 */
export async function pinRegistrationFile(
  file: RegistrationFile,
  pin: IpfsPinner,
  opts: PinRegistrationFileOptions = {},
): Promise<{ cid: string }> {
  const json = JSON.stringify(file)
  const bytes = new TextEncoder().encode(json)

  const signal = buildSignal(opts)
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
  }

  try {
    const result = await pin(bytes)
    if (typeof result !== 'object' || result === null || typeof result.cid !== 'string') {
      throw new Error('pinner returned a malformed result (expected { cid: string })')
    }
    return result
  } catch (err) {
    // Caller-initiated aborts propagate untouched — do not wrap them as a
    // RegistrationError so callers can `catch (err) { if (err.name === 'AbortError') ... }`.
    if (opts.signal?.aborted === true) throw err
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new RegistrationError({
      step: 'ipfs',
      ...(err instanceof Error && { cause: err }),
    })
  }
}

function buildSignal(opts: PinRegistrationFileOptions): AbortSignal | undefined {
  if (opts.signal === undefined && opts.timeoutMs === undefined) return undefined
  if (opts.timeoutMs === undefined) return opts.signal
  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs)
  if (opts.signal === undefined) return timeoutSignal
  return AbortSignal.any([opts.signal, timeoutSignal])
}
