/**
 * `verifyPortalHost` — the layered trust gate that proves a relay
 * descriptor binds its hostname to an on-chain agent identity Portal
 * expects to be there.
 *
 * Four layers in the portal trust model:
 *
 *   Layer 1 — TLS.      Runtime concern. When the fetch that populated
 *                       the descriptor succeeded over HTTPS, the relay's
 *                       certificate chain has already been verified by
 *                       Node / the browser. portal-tunnel's ENSIP-17
 *                       DNSSEC pipeline guarantees the hostname ↔ TLS
 *                       binding is real. We do not wrap Node's TLS stack.
 *   Layer 2 — ENS.      The relay's advertised `address` reverse-resolves
 *                       to an ENS name on the ENS-bearing chain (mainnet).
 *                       viem's `getEnsName` is the lookup.
 *   Layer 3 — ERC-8004. The claimed agent id exists in the Identity
 *                       Registry and its authoritative `agentWallet`
 *                       matches the descriptor's `address`.
 *   Layer 4 — ENSIP-25. The ENS name announces the agent id via the
 *                       ENSIP-25 text record `agent-registration[...][id]`
 *                       = `'1'`. Delegated to `crossCheckEnsip25`.
 *
 * Layer 1 is implicit (the caller must have fetched over HTTPS). Layers
 * 2-4 are explicit and composable — a failure at any layer throws
 * `RelayVerificationError` with a typed `reason` discriminant.
 *
 * A future commit adds **Layer 0** — descriptor signature verification
 * via `verifyRelayDescriptorSignature`. Once live, Layer 0 runs first so
 * downstream layers trust the `address` field.
 */

import type { Address, PublicClient } from 'viem'
import { crossCheckEnsip25 } from '../ensip25/bidirectional'
import type { Eip155ChainId } from '../ensip25/text-key'
import type { IdentityRegistryClient } from '../erc8004/identity-registry'
import { RelayVerificationError } from '../errors/relay'
import type { RelayDescriptor } from './discovery'
import { verifyRelayDescriptorSignature } from './verify-signature'

/** Narrow read-side contract — only the ENS lookups we call on the resolver client. */
export type EnsResolverClient = Pick<PublicClient, 'getEnsName' | 'getEnsText'>

/** Inputs to {@link verifyPortalHost}. */
export type VerifyPortalHostArgs = {
  /** Signed descriptor from {@link fetchDiscovery}. Its `address` is the trust anchor. */
  descriptor: RelayDescriptor
  /** Relay hostname that was contacted (for error messages + TLS binding context). */
  host: string
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
  /**
   * Run Layer 0 (descriptor signature verification) when `descriptor.signature`
   * is non-empty. Defaults to `true`. Disable only for legacy relays that
   * still emit unsigned descriptors on a pinned port.
   */
  verifyDescriptorSignature?: boolean
}

/** Result of a passing verification. All fields are cross-checked to agree. */
export type VerifyPortalHostResult = {
  host: string
  ensName: string
  agentId: bigint
  agentAddress: Address
}

/**
 * Run all three explicit trust layers against a signed relay descriptor.
 * Throws `RelayVerificationError` on any mismatch; returns the verified
 * record on success. Layer 1 (TLS) is the caller's responsibility — the
 * fetches that populated the discovery descriptor must have been HTTPS.
 *
 * @example
 * ```ts
 * const { relays } = await fetchDiscovery({ relayBaseUrl })
 * const best = selectBestRelay({ relays })
 * if (best === null) throw new Error('no reachable relays')
 * const verified = await verifyPortalHost({
 *   descriptor: best,
 *   host: 'relay-a.example.com',
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
  const advertisedAddress = args.descriptor.address as Address
  const verifySignature = args.verifyDescriptorSignature ?? true

  // Layer 0 — signed descriptor: only when the descriptor carries a
  // signature and verification is enabled. We don't require a signature
  // (bootstrap discovery may be unsigned); we just refuse to trust a
  // bad one.
  if (verifySignature && args.descriptor.signature.trim() !== '') {
    await verifyRelayDescriptorSignature({ descriptor: args.descriptor, host: args.host })
  }

  // Layer 2 — ENS reverse: the relay's advertised address resolves to an ENS name.
  const ensName = await reverseResolveEns(args, advertisedAddress)

  // Layer 3 — ERC-8004 agent record exists + its authoritative wallet matches
  // the descriptor's address. This is the on-chain anchor.
  const agent = await fetchAgentOrThrow(args)
  if (advertisedAddress.toLowerCase() !== agent.agentWallet.toLowerCase()) {
    throw new RelayVerificationError({
      host: args.host,
      reason: 'erc8004-missing',
      metaMessages: [
        `descriptor address ${advertisedAddress} does not match ERC-8004 agentWallet ${agent.agentWallet}`,
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

async function reverseResolveEns(
  args: VerifyPortalHostArgs,
  advertisedAddress: Address,
): Promise<string> {
  let ensName: string | null
  try {
    // `getEnsName` expects an address — the portal trust model binds the
    // relay's advertised address (the descriptor signer) to its ENS name.
    // Resolving *from* the address ensures the reverse record is
    // authoritative (the address owner controls reverse resolution).
    ensName = await args.ensClient.getEnsName({ address: advertisedAddress })
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
      metaMessages: [`no reverse ENS record for ${advertisedAddress}`],
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
