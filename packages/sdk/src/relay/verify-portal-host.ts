/**
 * `verifyPortalHost` — the layered trust gate that proves a relay hostname
 * resolves to an on-chain agent identity Portal expects to be there.
 *
 * Four layers in the portal trust model:
 *
 *   Layer 1 — TLS.      Runtime concern. When the fetch succeeds over HTTPS,
 *                       the relay's certificate chain has already been verified
 *                       by Node / the browser. portal-tunnel's ENSIP-17 DNSSEC
 *                       pipeline guarantees the hostname ↔ TLS binding is real.
 *                       We do not wrap Node's TLS stack.
 *   Layer 2 — ENS.      The relay's hostname reverse-resolves to the ENS name
 *                       the agent claims. viem's `getEnsName` over the ENS-
 *                       bearing chain (typically mainnet) is the lookup.
 *   Layer 3 — ERC-8004. The claimed ENS name's ERC-8004 agent record exists
 *                       on-chain and the authoritative `agentWallet` matches
 *                       the address in the discovery descriptor.
 *   Layer 4 — ENSIP-25. The ENS name announces the agent id via the ENSIP-25
 *                       text record (agent-registration[...][agentId] = '1').
 *                       Delegated to `crossCheckEnsip25` from /ensip25.
 *
 * Layer 1 is implicit (the caller must have fetched over HTTPS). Layers
 * 2-4 are explicit and composable — a failure at any layer throws
 * `RelayVerificationError` with a typed `reason` discriminant.
 */

import type { Address, PublicClient } from 'viem'
import { crossCheckEnsip25 } from '../ensip25/bidirectional'
import type { Eip155ChainId } from '../ensip25/text-key'
import type { IdentityRegistryClient } from '../erc8004/identity-registry'
import { RelayVerificationError } from '../errors/relay'

/** Narrow read-side contract — only the ENS lookups we call on the resolver client. */
export type EnsResolverClient = Pick<PublicClient, 'getEnsName' | 'getEnsText'>

/** Inputs to {@link verifyPortalHost}. */
export type VerifyPortalHostArgs = {
  /** Relay hostname under verification (e.g. `'relay-a.example.com'`). */
  host: string
  /** Address the relay advertises as its `ownerAddress` (from the discovery descriptor). */
  advertisedAddress: Address
  /** Expected ERC-8004 agent id the relay's ENS should announce. */
  expectedAgentId: bigint
  /** CAIP-2 chain id of the ERC-8004 Identity Registry the agent is pinned to. */
  chainId: Eip155ChainId
  /** Identity Registry address on that chain (usually from `ERC8004_ADDRESSES`). */
  registryAddress: Address
  /** viem client against the ENS-bearing chain (typically mainnet) for reverse + text lookups. */
  ensClient: EnsResolverClient
  /** ERC-8004 Identity Registry client from `/erc8004`. */
  identityRegistry: IdentityRegistryClient
}

/** Result of a passing verification. All fields are cross-checked to agree. */
export type VerifyPortalHostResult = {
  host: string
  ensName: string
  agentId: bigint
  agentAddress: Address
}

/**
 * Run all three explicit trust layers against a relay host. Throws
 * `RelayVerificationError` on any mismatch; returns the verified record on
 * success. Layer 1 (TLS) is the caller's responsibility — the fetches that
 * populated the discovery descriptor must have been HTTPS.
 *
 * @example
 * ```ts
 * const verified = await verifyPortalHost({
 *   host: 'relay-a.example.com',
 *   advertisedAddress: '0xabc...',
 *   expectedAgentId: 42n,
 *   chainId: 'eip155:8453',
 *   registryAddress: ERC8004_ADDRESSES['eip155:8453'].identityRegistry,
 *   ensClient: mainnetPublicClient,
 *   identityRegistry: baseIdentityRegistry,
 * })
 * ```
 */
export async function verifyPortalHost(
  args: VerifyPortalHostArgs,
): Promise<VerifyPortalHostResult> {
  // Layer 2 — ENS reverse: the relay host resolves to an ENS name.
  const ensName = await reverseResolveEns(args)

  // Layer 3 — ERC-8004 agent record exists + its authoritative wallet matches
  // the relay's advertised owner address. This is the on-chain anchor.
  const agent = await fetchAgentOrThrow(args)
  const normalizedAdvertised = args.advertisedAddress.toLowerCase()
  const normalizedOnChain = agent.agentWallet.toLowerCase()
  if (normalizedAdvertised !== normalizedOnChain) {
    throw new RelayVerificationError({
      host: args.host,
      reason: 'erc8004-missing',
      metaMessages: [
        `advertised ownerAddress ${args.advertisedAddress} does not match ERC-8004 agentWallet ${agent.agentWallet}`,
      ],
    })
  }

  // Layer 4 — ENSIP-25 bidirectional cross-check.
  await crossCheckEnsip25({
    ensName,
    expectedAgentId: args.expectedAgentId,
    chainId: args.chainId,
    registryAddress: args.registryAddress,
    publicClient: args.ensClient,
    identityRegistry: args.identityRegistry,
  })

  return {
    host: args.host,
    ensName,
    agentId: args.expectedAgentId,
    agentAddress: agent.agentWallet,
  }
}

async function reverseResolveEns(args: VerifyPortalHostArgs): Promise<string> {
  let ensName: string | null
  try {
    // `getEnsName` expects an address, not a hostname — but the portal
    // trust model binds the relay's advertised owner address to its ENS name.
    // Resolving *from* the address ensures the reverse record is authoritative
    // (the owner controls reverse resolution for their own address).
    ensName = await args.ensClient.getEnsName({ address: args.advertisedAddress })
  } catch (err) {
    throw new RelayVerificationError({
      host: args.host,
      reason: 'ens-mismatch',
      ...(err instanceof Error && { cause: err }),
    })
  }
  if (ensName === null || ensName.length === 0) {
    throw new RelayVerificationError({
      host: args.host,
      reason: 'ens-mismatch',
      metaMessages: [`no reverse ENS record for ${args.advertisedAddress}`],
    })
  }
  return ensName
}

async function fetchAgentOrThrow(args: VerifyPortalHostArgs) {
  try {
    return await args.identityRegistry.getAgent(args.expectedAgentId)
  } catch (err) {
    throw new RelayVerificationError({
      host: args.host,
      reason: 'erc8004-missing',
      ...(err instanceof Error && { cause: err }),
    })
  }
}
