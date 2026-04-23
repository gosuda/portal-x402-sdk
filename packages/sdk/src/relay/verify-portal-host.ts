/**
 * `verifyPortalHost` — the layered trust gate that proves a relay
 * descriptor binds its hostname to an on-chain agent identity Portal
 * expects to be there.
 *
 * Five layers in the portal trust model:
 *
 *   Layer 1 — TLS.      Runtime concern. When the fetch that populated
 *                       the descriptor succeeded over HTTPS, the relay's
 *                       certificate chain has already been verified by
 *                       Node / the browser. portal-tunnel's ENSIP-17
 *                       DNSSEC pipeline guarantees the hostname ↔ TLS
 *                       binding is real. We do not wrap Node's TLS stack.
 *   Layer 0 — Signed    The v2.1.7 descriptor carries a secp256k1
 *     descriptor.       recoverable signature whose recovered address
 *                       must equal `descriptor.address`. Delegated to
 *                       `verifyRelayDescriptorSignature`.
 *   Layer 2 — ENS.      The relay's advertised `address` reverse-resolves
 *                       to an ENS name on the ENS-bearing chain (mainnet).
 *                       viem's `getEnsName` is the lookup.
 *   Layer 3 — ERC-8004. The claimed agent id exists in the Identity
 *                       Registry and its authoritative `agentWallet`
 *                       matches the descriptor's `address`.
 *   Layer 4 — Trust     One or more {@link TrustAnchor} cross-checks.
 *     anchors.          Defaults to ENSIP-25 (`agent-registration[...][id]
 *                       = '1'`), but swaps cheaply for ENSIP-26 /
 *                       `agent.arp` / a custom adapter — the ENS DAO is
 *                       actively debating successors, so we don't
 *                       hard-code a single standard.
 *
 * Layer 1 is implicit (the caller must have fetched over HTTPS). Layers
 * 0, 2-4 are explicit and composable — a failure at any layer throws
 * `RelayVerificationError` with a typed `reason` discriminant.
 */

import type { Address, PublicClient } from 'viem'
import type { Eip155ChainId } from '../ensip25/text-key'
import type { IdentityRegistryClient } from '../erc8004/identity-registry'
import { RelayVerificationError } from '../errors/relay'
import type { RelayDescriptor } from './discovery'
import { ensip25TrustAnchor, type TrustAnchor } from './trust-anchor'
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
  /**
   * Layer 4 trust anchors. Defaults to `[ensip25TrustAnchor({ chainId,
   * registryAddress })]` — the current SDK default stays ENSIP-25. Pass
   * an explicit list to swap in ENSIP-26, `agent.arp`, or a custom
   * adapter; all supplied anchors must pass (AND semantics). Pass an
   * empty array to skip Layer 4 entirely (rare — advanced callers only).
   */
  trustAnchors?: readonly TrustAnchor[]
}

/** Result of a passing verification. All fields are cross-checked to agree. */
export type VerifyPortalHostResult = {
  host: string
  ensName: string
  agentId: bigint
  agentAddress: Address
  /** Names of the trust anchors that passed Layer 4, in execution order. */
  trustAnchors: readonly string[]
}

/**
 * Run every explicit trust layer against a signed relay descriptor.
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
  const trustAnchors = args.trustAnchors ?? [
    ensip25TrustAnchor({ chainId: args.chainId, registryAddress: args.registryAddress }),
  ]

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

  // Layer 4 — pluggable trust anchors, all must pass.
  const passedAnchorNames: string[] = []
  for (const anchor of trustAnchors) {
    await anchor.verify({
      host: args.host,
      ensName,
      expectedAgentId: args.expectedAgentId,
      advertisedAddress,
      ensClient: args.ensClient,
      identityRegistry: args.identityRegistry,
    })
    passedAnchorNames.push(anchor.name)
  }

  return {
    host: args.host,
    ensName,
    agentId: args.expectedAgentId,
    agentAddress: agent.agentWallet,
    trustAnchors: passedAnchorNames,
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
