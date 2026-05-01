/**
 * `createPortalClient()` — the single factory that wires the SDK's subpaths
 * together. Minimal default returns the payment trio
 * `{ facilitator, paidFetch, honoMiddleware }`; pass `identity: { ... }` to
 * opt in to on-chain reads + trust verification + relay selection.
 *
 * Design goals:
 *   - No hidden network calls at construction. Every method that touches IO
 *     is called explicitly by the consumer.
 *   - Tree-shakeable. A consumer that only uses `facilitator` never pays the
 *     cost of viem's ENS helpers or our `/erc8004` clients.
 *   - Consumers bring their own viem `PublicClient`/`WalletClient`. We do
 *     not instantiate transports — the caller owns chain configuration.
 */

import type { PublicClient, WalletClient } from 'viem'
import { type CreatePortalPaidFetchConfig, createPortalPaidFetch } from './client/paid-fetch'
import type { Erc8004ChainId } from './erc8004/addresses'
import {
  createIdentityRegistryClient,
  type IdentityRegistryClient,
} from './erc8004/identity-registry'
import {
  createReputationRegistryClient,
  type ReputationRegistryClient,
} from './erc8004/reputation-registry'
import {
  createPortalFacilitator,
  type PortalFacilitator,
  type PortalFacilitatorConfig,
} from './facilitator/client'
import {
  type CreatePortalHonoMiddlewareConfig,
  createPortalHonoMiddleware,
} from './hono/middleware'
import { type DiscoveryResponse, fetchDiscovery } from './relay/discovery'
import { type SelectBestRelayArgs, selectBestRelay } from './relay/select-best-relay'
import {
  type VerifyPortalHostArgs,
  type VerifyPortalHostResult,
  verifyPortalHost,
} from './relay/verify-portal-host'

/** Identity layer configuration. When present, `createPortalClient` enables on-chain + trust features. */
export type PortalIdentityConfig = {
  /** CAIP-2 chain id of the ERC-8004 registries. */
  chainId: Erc8004ChainId
  /** viem PublicClient pinned to the above chain. Used for ERC-8004 reads. */
  publicClient: PublicClient
  /**
   * Optional separate viem client for ENS resolution — usually mainnet.
   * Defaults to `publicClient` when omitted (valid when the identity chain
   * is already Ethereum mainnet).
   */
  ensClient?: PublicClient
}

/** Payment layer configuration. */
export type PortalPaymentConfig = {
  /** Facilitator client config. Passed verbatim to `createPortalFacilitator`. */
  facilitator?: PortalFacilitatorConfig
  /** paidFetch config. Passed verbatim to `createPortalPaidFetch`. */
  paidFetch?: Omit<CreatePortalPaidFetchConfig, 'fetch'>
  /** Custom underlying fetch shared between the facilitator + paidFetch. */
  fetch?: typeof globalThis.fetch
}

/** Full configuration for {@link createPortalClient}. */
export type CreatePortalClientConfig = {
  payment?: PortalPaymentConfig
  identity?: PortalIdentityConfig
}

/** Payment-layer handles. Always present. */
export type PortalPaymentHandles = {
  facilitator: PortalFacilitator
  paidFetch: ReturnType<typeof createPortalPaidFetch>
  /**
   * Builder for the Hono middleware. Not prebuilt — consumers supply their
   * routes + schemes at use site. The facilitator + shared config are
   * pre-bound so the call site stays minimal.
   */
  createHonoMiddleware: (
    config: Omit<CreatePortalHonoMiddlewareConfig, 'facilitator'>,
  ) => ReturnType<typeof createPortalHonoMiddleware>
}

/** Identity-layer handles. Only present when `config.identity` is supplied. */
export type PortalIdentityHandles = {
  identityRegistry: IdentityRegistryClient
  reputationRegistry: ReputationRegistryClient
  /** Fetch a relay's `/discovery` response. */
  fetchDiscovery: (relayBaseUrl: string) => Promise<DiscoveryResponse>
  /** Filter + rank relays by reputation. */
  selectBestRelay: (
    args: Omit<SelectBestRelayArgs, 'now'> & { now?: Date },
  ) => ReturnType<typeof selectBestRelay>
  /**
   * Run the layered trust gate. `ensClient` and `identityRegistry` are
   * pre-bound — the consumer only supplies host + advertised address + agent id.
   */
  verifyPortalHost: (
    args: Omit<
      VerifyPortalHostArgs,
      'chainId' | 'registryAddress' | 'ensClient' | 'identityRegistry'
    >,
  ) => Promise<VerifyPortalHostResult>
}

/**
 * The unified Portal client. Payment handles are always present; identity
 * handles appear only when `config.identity` is provided.
 */
export type PortalClient = PortalPaymentHandles & {
  identity?: PortalIdentityHandles
}

/**
 * Wire the SDK's subpaths into a single client. Pass only `payment` for a
 * lean 3-field client that ignores on-chain reads; add `identity` to
 * enable ERC-8004 lookups, `/discovery` parsing, relay selection, and
 * `verifyPortalHost`.
 *
 * @example
 * ```ts
 * import { createPortalClient } from '@portal-tunnel/x402-sdk'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { createPublicClient, http } from 'viem'
 * import { base, mainnet } from 'viem/chains'
 *
 * const signer = privateKeyToAccount('0x...')
 * const basePublic = createPublicClient({ chain: base, transport: http() })
 * const ensPublic = createPublicClient({ chain: mainnet, transport: http() })
 *
 * const portal = createPortalClient({
 *   payment: { paidFetch: { signer } },
 *   identity: {
 *     chainId: 'eip155:8453',
 *     publicClient: basePublic,
 *     ensClient: ensPublic,
 *   },
 * })
 *
 * const res = await portal.paidFetch('https://api.example.com/premium')
 * const agent = await portal.identity?.identityRegistry.getAgent(1n)
 * ```
 */
export function createPortalClient(config: CreatePortalClientConfig = {}): PortalClient {
  const payment = buildPaymentHandles(config.payment)
  if (config.identity === undefined) return payment
  const identity = buildIdentityHandles(config.identity)
  return { ...payment, identity }
}

function buildPaymentHandles(config: PortalPaymentConfig | undefined): PortalPaymentHandles {
  const facilitatorCfg: PortalFacilitatorConfig = {
    ...(config?.facilitator ?? {}),
    ...(config?.fetch !== undefined && { fetch: config.fetch }),
  }
  const facilitator = createPortalFacilitator(facilitatorCfg)

  const paidFetchCfg: CreatePortalPaidFetchConfig = {
    ...(config?.paidFetch ?? {}),
    ...(config?.fetch !== undefined && { fetch: config.fetch }),
  }
  const paidFetch = createPortalPaidFetch(paidFetchCfg)

  return {
    facilitator,
    paidFetch,
    createHonoMiddleware: (middleware) =>
      createPortalHonoMiddleware({ ...middleware, facilitator }),
  }
}

function buildIdentityHandles(config: PortalIdentityConfig): PortalIdentityHandles {
  const identityRegistry = createIdentityRegistryClient({
    chainId: config.chainId,
    publicClient: config.publicClient,
  })
  const reputationRegistry = createReputationRegistryClient({
    chainId: config.chainId,
    publicClient: config.publicClient,
  })
  const ensClient: PublicClient = config.ensClient ?? config.publicClient

  return {
    identityRegistry,
    reputationRegistry,
    fetchDiscovery: (relayBaseUrl) => fetchDiscovery({ relayBaseUrl }),
    selectBestRelay: (args) => selectBestRelay(args),
    verifyPortalHost: (args) =>
      verifyPortalHost({
        ...args,
        chainId: config.chainId,
        registryAddress: identityRegistry.address,
        ensClient,
        identityRegistry,
      }),
  }
}

// Narrow re-exports so consumers can type their own helpers without
// importing subpath deep.
export type { WalletClient }
