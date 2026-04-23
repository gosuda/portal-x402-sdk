/**
 * Pluggable trust anchor abstraction for `verifyPortalHost` Layer 4.
 *
 * Layer 4 is the "ENS name announces the agent id" proof. ENSIP-25 is
 * the current defacto standard (text record
 * `agent-registration[<erc7930-hex>][<agentId>] = '1'`), but the ENS
 * DAO is actively debating successors — ENSIP-26 "ENS Native AI
 * Identity" and an `agent.arp` record format both have forum traction.
 * We don't know which lands; we do know consumers will want to switch
 * cheaply.
 *
 * A `TrustAnchor` is a function the relay trust gate runs against the
 * shared verification context — `{ host, ensName, expectedAgentId,
 * advertisedAddress, ensClient, identityRegistry }`. Multiple anchors
 * can be composed (all must pass = AND semantics). The SDK ships
 * `ensip25TrustAnchor` as the default so existing consumers see no
 * behavior change; future ENSIP-26 / agent.arp adapters slot in
 * without touching `verifyPortalHost` itself.
 *
 * This module stays transport-pure — it imports `crossCheckEnsip25`
 * from `/ensip25` and exposes the factory here so that `/relay`
 * remains the one place the trust gate is assembled.
 */

import type { Address, PublicClient } from 'viem'
import { crossCheckEnsip25 } from '../ensip25/bidirectional'
import type { Eip155ChainId } from '../ensip25/text-key'
import type { IdentityRegistryClient } from '../erc8004/identity-registry'

/**
 * Narrow read-side contract — only the ENS text + reverse lookups the
 * bundled trust anchors need. Matches `EnsResolverClient` from
 * `verify-portal-host` so consumers can pass a single client to both.
 */
export type TrustAnchorEnsClient = Pick<PublicClient, 'getEnsName' | 'getEnsText'>

/**
 * Shared context passed to every trust anchor during `verifyPortalHost`.
 * Populated by the gate after Layers 0-3 have resolved the relay's
 * address and ENS name.
 */
export type TrustAnchorContext = {
  host: string
  ensName: string
  expectedAgentId: bigint
  advertisedAddress: Address
  ensClient: TrustAnchorEnsClient
  identityRegistry: IdentityRegistryClient
}

/**
 * A composable cross-check executed as part of Layer 4. Implementations
 * throw `RelayVerificationError` with a typed `reason` on failure;
 * resolving means the anchor passed.
 */
export interface TrustAnchor {
  /** Stable identifier for the anchor (e.g. `'ensip25'`, `'ensip26'`, `'agent-arp'`). */
  readonly name: string
  verify(context: TrustAnchorContext): Promise<void>
}

/** Configuration for the bundled ENSIP-25 adapter. */
export type Ensip25TrustAnchorConfig = {
  /** CAIP-2 chain id of the ERC-8004 Identity Registry the agent is pinned to. */
  chainId: Eip155ChainId
  /** Identity Registry address on that chain (usually from `ERC8004_ADDRESSES`). */
  registryAddress: Address
}

/**
 * Build a {@link TrustAnchor} that delegates to `crossCheckEnsip25`.
 * This is the default anchor wired into `verifyPortalHost` — the
 * SDK's out-of-the-box Layer 4 behavior is unchanged when no
 * `trustAnchors` argument is supplied.
 *
 * @example
 * ```ts
 * const anchor = ensip25TrustAnchor({
 *   chainId: 'eip155:8453',
 *   registryAddress: ERC8004_ADDRESSES['eip155:8453'].identityRegistry,
 * })
 * await verifyPortalHost({ ...args, trustAnchors: [anchor] })
 * ```
 */
export function ensip25TrustAnchor(config: Ensip25TrustAnchorConfig): TrustAnchor {
  return {
    name: 'ensip25',
    async verify(context) {
      await crossCheckEnsip25({
        ensName: context.ensName,
        expectedAgentId: context.expectedAgentId,
        chainId: config.chainId,
        registryAddress: config.registryAddress,
        publicClient: context.ensClient,
        identityRegistry: context.identityRegistry,
      })
    },
  }
}
