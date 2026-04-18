import {
  type PaymentPolicy,
  type SchemeRegistration,
  type SelectPaymentRequirements,
  x402Client,
} from '@x402/core/client'
import type { Network } from '@x402/core/types'
import type { ClientEvmSigner } from '@x402/evm'
import { type ExactEvmSchemeOptions, registerExactEvmScheme } from '@x402/evm/exact/client'
import { wrapFetchWithPayment } from '@x402/fetch'

/** Configuration for {@link createPortalPaidFetch}. */
export type CreatePortalPaidFetchConfig = {
  /**
   * EVM client signer. Shortcut: when provided, `ExactEvmScheme` is
   * auto-registered (V2 wildcard `eip155:*` and V1 per-network) via
   * upstream's `registerExactEvmScheme`.
   *
   * Combine with `schemes` for multi-family wallets (e.g. EVM + Solana).
   */
  signer?: ClientEvmSigner
  /**
   * Manual scheme registrations. Use this on its own for non-EVM chains
   * or together with `signer` to extend the EVM defaults.
   */
  schemes?: SchemeRegistration[]
  /** Payment requirements filters, applied in order after scheme filtering. */
  policies?: PaymentPolicy[]
  /** Selector that chooses one requirement from the 402 response. */
  paymentRequirementsSelector?: SelectPaymentRequirements
  /** ExactEvmScheme options (RPC URL, per-chain config). Only used with `signer`. */
  schemeOptions?: ExactEvmSchemeOptions
  /** Restrict EVM registration to specific networks. Defaults to `eip155:*`. */
  networks?: Network[]
  /** Underlying fetch. Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch
}

/**
 * Create a `fetch`-compatible function that auto-pays 402 Payment Required
 * responses, plugging in Portal-specific defaults on top of `@x402/fetch`.
 *
 * Value-add over calling `wrapFetchWithPayment` directly:
 * - One-line EVM setup: pass a viem account (or any `ClientEvmSigner`) and the
 *   Exact scheme is wired on `eip155:*` for both v2 and v1 automatically.
 * - Same option surface as `@x402/fetch` (policies, selector, custom schemes)
 *   so migration stays trivial.
 *
 * The wire-level payment handshake — 402 parsing, `PAYMENT-SIGNATURE` (v2) /
 * `X-PAYMENT` (v1) encoding, loop prevention — is owned entirely by upstream;
 * we do not reimplement.
 *
 * @example
 * ```ts
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { createPortalPaidFetch } from '@gosuda/portal-x402-sdk/client'
 *
 * const signer = privateKeyToAccount('0x...')
 * const paidFetch = createPortalPaidFetch({ signer })
 * const res = await paidFetch('https://api.example.com/paid')
 * ```
 */
export function createPortalPaidFetch(
  config: CreatePortalPaidFetchConfig = {},
): typeof globalThis.fetch {
  if (config.signer === undefined && (config.schemes ?? []).length === 0) {
    throw new Error(
      'createPortalPaidFetch requires either `signer` (shortcut for ExactEvmScheme) or `schemes` (manual registrations).',
    )
  }

  const client = new x402Client(config.paymentRequirementsSelector)

  if (config.signer !== undefined) {
    registerExactEvmScheme(client, {
      signer: config.signer,
      ...(config.schemeOptions !== undefined && { schemeOptions: config.schemeOptions }),
      ...(config.networks !== undefined && { networks: config.networks }),
    })
  }

  for (const { network, client: schemeClient, x402Version } of config.schemes ?? []) {
    if (x402Version === 1) {
      client.registerV1(network, schemeClient)
    } else {
      client.register(network, schemeClient)
    }
  }

  for (const policy of config.policies ?? []) {
    client.registerPolicy(policy)
  }

  const underlyingFetch = config.fetch ?? globalThis.fetch
  return wrapFetchWithPayment(underlyingFetch, client)
}
