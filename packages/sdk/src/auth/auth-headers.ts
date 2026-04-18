import type { FacilitatorConfig } from '@x402/core/http'
import { type EVMSigner, encodeSIWxHeader } from '@x402/extensions/sign-in-with-x'
import type { Address } from 'viem'
import type { PortalSiwxAuth } from './portal-siwx'

/**
 * Canonical x402 v2 SIWX header name
 * (`@x402/extensions/sign-in-with-x` `parseSIWxHeader` expects this key).
 */
const SIGN_IN_WITH_X_HEADER = 'SIGN-IN-WITH-X'
const AUTHORIZATION_HEADER = 'Authorization'

/** Where the base64 SIWX payload lands in the HTTP request. */
export type SiwxAuthHeaderScheme =
  /** `SIGN-IN-WITH-X: <base64>` — x402 v2 canonical (default). */
  | 'sign-in-with-x'
  /** `Authorization: Bearer <base64>` — for facilitators that auth on the Authorization header. */
  | 'bearer'

/** Which facilitator paths should carry the SIWX header. All three default to true. */
export type SiwxAuthHeaderPaths = {
  verify?: boolean
  settle?: boolean
  supported?: boolean
}

/** Configuration for {@link createSiwxAuthHeaders}. */
export type CreateSiwxAuthHeadersConfig = {
  /** A `PortalSiwxAuth` built by `createPortalSiwx({ ... })`. */
  siwx: PortalSiwxAuth
  /** Consumer wallet address. Included on every signed challenge. */
  address: Address
  /** EVM signer used to sign each fresh challenge. */
  signer: EVMSigner
  /** Header scheme. Default `'sign-in-with-x'`. */
  scheme?: SiwxAuthHeaderScheme
  /** Per-path toggle. Default: all three enabled. */
  paths?: SiwxAuthHeaderPaths
}

/**
 * Build a `createAuthHeaders` function compatible with
 * `@x402/core/http FacilitatorConfig`. Drop the return value straight into
 * `createPortalFacilitator({ createAuthHeaders: ... })`.
 *
 * On every facilitator request, a fresh SIWX challenge is built and signed
 * (new nonce, new issuedAt), then base64-encoded and attached to the chosen
 * header on each path listed in `paths` (all three by default).
 *
 * @example
 * ```ts
 * const siwx = createPortalSiwx({ domain: 'app.example', uri: 'https://app.example/portal' })
 * const fac = createPortalFacilitator({
 *   createAuthHeaders: createSiwxAuthHeaders({ siwx, address, signer: account }),
 * })
 * ```
 */
export function createSiwxAuthHeaders(
  config: CreateSiwxAuthHeadersConfig,
): NonNullable<FacilitatorConfig['createAuthHeaders']> {
  const scheme = config.scheme ?? 'sign-in-with-x'
  const attachVerify = config.paths?.verify ?? true
  const attachSettle = config.paths?.settle ?? true
  const attachSupported = config.paths?.supported ?? true

  return async () => {
    const payload = await config.siwx.sign({
      address: config.address,
      signer: config.signer,
    })
    const encoded = encodeSIWxHeader(payload)
    const headers: Record<string, string> =
      scheme === 'sign-in-with-x'
        ? { [SIGN_IN_WITH_X_HEADER]: encoded }
        : { [AUTHORIZATION_HEADER]: `Bearer ${encoded}` }
    return {
      verify: attachVerify ? headers : {},
      settle: attachSettle ? headers : {},
      supported: attachSupported ? headers : {},
    }
  }
}
