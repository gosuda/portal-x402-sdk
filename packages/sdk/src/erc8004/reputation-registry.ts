/**
 * ERC-8004 Reputation Registry client.
 *
 * Feedback-based: anyone can call `giveFeedback(agentId, value, decimals,
 * tag1, tag2, endpoint, feedbackURI, feedbackHash)` to attach a signed opinion
 * to an agent. Consumers aggregate feedback via `getSummary(agentId, clients[],
 * tag1, tag2)` which returns a count + averaged value over the selected client
 * set. Individual feedback entries can be read back via `readFeedback(agentId,
 * client, index)` and revoked by the original attester via `revokeFeedback`.
 *
 * Same thin-wrapper shape as the Identity Registry: every method delegates to
 * viem's typed `readContract` / `writeContract`; portal value-add is the
 * frozen address map, literal-union chain restriction, and unified error
 * mapping (`IdentityLookupError` for reads, `RegistrationError` for writes).
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { IdentityLookupError, RegistrationError } from '../errors/identity'
import { reputationRegistryAbi } from './abi'
import { ERC8004_ADDRESSES, type Erc8004ChainId } from './addresses'
import type { ReadOptions, WriteOptions } from './identity-registry'

/** Narrow read contract — the only `PublicClient` methods we call. */
export type ReputationReadClient = Pick<PublicClient, 'readContract' | 'waitForTransactionReceipt'>

/** Narrow write contract — the only `WalletClient` fields we touch. */
export type ReputationWriteClient = Pick<WalletClient, 'account' | 'chain' | 'writeContract'>

/** Inputs to `giveFeedback`. Mirrors the ABI signature 1:1. */
export type GiveFeedbackArgs = {
  agentId: bigint
  /** Feedback value as a signed fixed-point integer. Scale by `valueDecimals`. */
  value: bigint
  /** Decimal places for `value`. E.g. value=450 + decimals=2 → 4.50. */
  valueDecimals: number
  /** Primary tag, e.g. `'uptime'`, `'responseTime'`. Empty string = untagged. */
  tag1: string
  /** Secondary tag. Empty string if unused. */
  tag2: string
  /** Endpoint identifier the feedback targets (HTTP URL, method name, etc.). */
  endpoint: string
  /** Pointer to off-chain feedback details (ipfs://, https://, etc.). */
  feedbackURI: string
  /** Keccak256 of the feedback payload for integrity. */
  feedbackHash: Hex
}

/** Individual feedback entry returned by `readFeedback`. */
export type FeedbackEntry = {
  value: bigint
  valueDecimals: number
  tag1: string
  tag2: string
  isRevoked: boolean
}

/** Aggregated feedback summary returned by `getSummary`. */
export type FeedbackSummary = {
  count: bigint
  /** Sum of values (pre-division). Scale by `summaryValueDecimals`. */
  summaryValue: bigint
  summaryValueDecimals: number
}

export interface ReputationRegistryClient {
  readonly address: Address
  readonly chainId: Erc8004ChainId

  /** Read a specific feedback entry by (agentId, client, index). Throws {@link IdentityLookupError}. */
  readFeedback(
    args: { agentId: bigint; clientAddress: Address; feedbackIndex: bigint },
    opts?: ReadOptions,
  ): Promise<FeedbackEntry>

  /**
   * Aggregate feedback across a set of clients. `tag1`/`tag2` filter the
   * entries considered; empty strings match entries with no tag.
   */
  getSummary(
    args: {
      agentId: bigint
      clientAddresses: readonly Address[]
      tag1: string
      tag2: string
    },
    opts?: ReadOptions,
  ): Promise<FeedbackSummary>

  giveFeedback(
    args: GiveFeedbackArgs & { signer: ReputationWriteClient },
    opts?: WriteOptions,
  ): Promise<{ txHash: Hex }>

  revokeFeedback(
    args: { agentId: bigint; feedbackIndex: bigint; signer: ReputationWriteClient },
    opts?: WriteOptions,
  ): Promise<{ txHash: Hex }>
}

export type CreateReputationRegistryClientConfig = {
  chainId: Erc8004ChainId
  publicClient: ReputationReadClient
  /** Override the canonical registry address (anvil / test deployment). */
  address?: Address
}

/**
 * Create a Reputation Registry client.
 *
 * @example
 * ```ts
 * const rep = createReputationRegistryClient({ chainId: 'eip155:8453', publicClient })
 * const summary = await rep.getSummary({
 *   agentId: 1n,
 *   clientAddresses: ['0xabc...', '0xdef...'],
 *   tag1: 'uptime',
 *   tag2: '',
 * })
 * ```
 */
export function createReputationRegistryClient(
  config: CreateReputationRegistryClientConfig,
): ReputationRegistryClient {
  const address = config.address ?? ERC8004_ADDRESSES[config.chainId].reputationRegistry
  const publicClient = config.publicClient
  const chainId = config.chainId

  return {
    address,
    chainId,

    async readFeedback(args, opts) {
      try {
        const tuple = (await publicClient.readContract({
          address,
          abi: reputationRegistryAbi,
          functionName: 'readFeedback',
          args: [args.agentId, args.clientAddress, args.feedbackIndex],
          ...(opts?.blockTag !== undefined && { blockTag: opts.blockTag }),
        })) as readonly [bigint, number, string, string, boolean]
        return {
          value: tuple[0],
          valueDecimals: tuple[1],
          tag1: tuple[2],
          tag2: tuple[3],
          isRevoked: tuple[4],
        }
      } catch (err) {
        throw new IdentityLookupError({
          agentId: args.agentId,
          ...(err instanceof Error && { cause: err }),
        })
      }
    },

    async getSummary(args, opts) {
      try {
        const tuple = (await publicClient.readContract({
          address,
          abi: reputationRegistryAbi,
          functionName: 'getSummary',
          args: [args.agentId, args.clientAddresses, args.tag1, args.tag2],
          ...(opts?.blockTag !== undefined && { blockTag: opts.blockTag }),
        })) as readonly [bigint, bigint, number]
        return {
          count: tuple[0],
          summaryValue: tuple[1],
          summaryValueDecimals: tuple[2],
        }
      } catch (err) {
        throw new IdentityLookupError({
          agentId: args.agentId,
          ...(err instanceof Error && { cause: err }),
        })
      }
    },

    async giveFeedback(args, opts) {
      const signerAccount = args.signer.account
      if (signerAccount === undefined) {
        throw new RegistrationError({
          step: 'registry',
          cause: new Error('signer has no account attached'),
        })
      }
      let txHash: Hex
      try {
        txHash = await args.signer.writeContract({
          address,
          abi: reputationRegistryAbi,
          functionName: 'giveFeedback',
          args: [
            args.agentId,
            args.value,
            args.valueDecimals,
            args.tag1,
            args.tag2,
            args.endpoint,
            args.feedbackURI,
            args.feedbackHash,
          ],
          account: signerAccount,
          chain: args.signer.chain ?? null,
        })
      } catch (err) {
        throw new RegistrationError({
          step: 'registry',
          ...(err instanceof Error && { cause: err }),
        })
      }
      try {
        await publicClient.waitForTransactionReceipt({
          hash: txHash,
          confirmations: opts?.confirmations ?? 1,
          ...(opts?.timeoutMs !== undefined && { timeout: opts.timeoutMs }),
        })
      } catch (err) {
        throw new RegistrationError({
          step: 'receipt',
          ...(err instanceof Error && { cause: err }),
        })
      }
      return { txHash }
    },

    async revokeFeedback(args, opts) {
      const signerAccount = args.signer.account
      if (signerAccount === undefined) {
        throw new RegistrationError({
          step: 'registry',
          cause: new Error('signer has no account attached'),
        })
      }
      const txHash = await args.signer.writeContract({
        address,
        abi: reputationRegistryAbi,
        functionName: 'revokeFeedback',
        args: [args.agentId, args.feedbackIndex],
        account: signerAccount,
        chain: args.signer.chain ?? null,
      })
      await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: opts?.confirmations ?? 1,
        ...(opts?.timeoutMs !== undefined && { timeout: opts.timeoutMs }),
      })
      return { txHash }
    },
  }
}
