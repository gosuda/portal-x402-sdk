/**
 * ERC-8004 Identity Registry client.
 *
 * The registry is an ERC-721 collection where each token = one agent. The
 * agent's URI (ERC-721 `tokenURI`) points at an off-chain registration file;
 * consumers pin it themselves via an `IpfsPinner` hook (see `./ipfs`) and
 * feed the resulting CID into `register({ agentURI: 'ipfs://<cid>' })`.
 *
 * This wrapper is intentionally thin: every method delegates to viem's
 * typed `readContract` / `simulateContract` / `writeContract` so the ABI
 * fragments in `./abi` own the decoding surface. Portal value-add is the
 * literal-union chain restriction, the frozen address map, and the unified
 * error mapping into `IdentityLookupError` / `RegistrationError`.
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { toEventSelector } from 'viem'
import { IdentityLookupError, RegistrationError } from '../errors/identity'
import { identityRegistryAbi } from './abi'
import { ERC8004_ADDRESSES, type Erc8004ChainId } from './addresses'

/**
 * Narrow read-side contract — the only `PublicClient` methods we call. Any
 * full viem `PublicClient` assigns to this by structural typing, but tests
 * can inject a minimal mock without recreating viem's full surface.
 */
export type IdentityReadClient = Pick<PublicClient, 'readContract' | 'waitForTransactionReceipt'>

/** Narrow write-side contract — the only `WalletClient` fields we touch. */
export type IdentityWriteClient = Pick<WalletClient, 'account' | 'chain' | 'writeContract'>

/** Read-level call options. Mirror `/facilitator` RequestOptions for consistency. */
export type ReadOptions = {
  signal?: AbortSignal
  /** Block tag / number the read is pinned to. Default: `'latest'`. */
  blockTag?: 'latest' | 'earliest' | 'finalized' | 'pending' | 'safe'
}

/** Write-level call options. */
export type WriteOptions = {
  signal?: AbortSignal
  /** Receipt confirmations to wait for. Default: 1. */
  confirmations?: number
  /** Timeout for `waitForTransactionReceipt`, in ms. */
  timeoutMs?: number
}

/** Full agent record — the unified read surface consumers want 95% of the time. */
export type AgentRecord = {
  agentId: bigint
  /** ERC-721 `tokenURI`. Typically `ipfs://<cid>` pointing at the registration file. */
  agentURI: string
  /**
   * ERC-8004 authoritative agent wallet (from `getAgentWallet`). May differ
   * from the ERC-721 `owner` if the agent rotated wallets via `setAgentWallet`.
   */
  agentWallet: Address
  /** ERC-721 owner (from `ownerOf`). The NFT holder. */
  owner: Address
}

/** Metadata blob stored on-chain under an `agentId × key` pair. */
export type AgentMetadata = {
  key: string
  value: Hex
}

export interface IdentityRegistryClient {
  /** Contract address (resolved from {@link ERC8004_ADDRESSES} unless overridden). */
  readonly address: Address
  readonly chainId: Erc8004ChainId

  /** Unified read — `tokenURI` + `getAgentWallet` + `ownerOf` in one. Throws {@link IdentityLookupError}. */
  getAgent(agentId: bigint, opts?: ReadOptions): Promise<AgentRecord>

  /** Single-field reads. Useful when the caller only needs one value. */
  getAgentURI(agentId: bigint, opts?: ReadOptions): Promise<string>
  getAgentWallet(agentId: bigint, opts?: ReadOptions): Promise<Address>
  getOwner(agentId: bigint, opts?: ReadOptions): Promise<Address>
  getMetadata(agentId: bigint, key: string, opts?: ReadOptions): Promise<Hex>

  /**
   * Register a new agent. If `agentURI` is provided, uses the single-arg
   * `register(string)` overload; otherwise uses no-arg `register()` (agentURI
   * can be set later with {@link setAgentURI}). Throws {@link RegistrationError}
   * with `step: 'registry'` on simulation/send failure, `step: 'receipt'` on
   * receipt/log decoding failure.
   */
  register(
    args: { agentURI?: string; signer: IdentityWriteClient },
    opts?: WriteOptions,
  ): Promise<{ agentId: bigint; txHash: Hex }>

  setAgentURI(
    args: { agentId: bigint; agentURI: string; signer: IdentityWriteClient },
    opts?: WriteOptions,
  ): Promise<{ txHash: Hex }>

  setMetadata(
    args: { agentId: bigint; key: string; value: Hex; signer: IdentityWriteClient },
    opts?: WriteOptions,
  ): Promise<{ txHash: Hex }>
}

/** Configuration for {@link createIdentityRegistryClient}. */
export type CreateIdentityRegistryClientConfig = {
  chainId: Erc8004ChainId
  publicClient: IdentityReadClient
  /** Override the canonical registry address (anvil / test deployment). */
  address?: Address
}

/**
 * Create an Identity Registry client for a specific EVM chain.
 *
 * @example
 * ```ts
 * import { createPublicClient, http } from 'viem'
 * import { base } from 'viem/chains'
 * import { createIdentityRegistryClient } from '@portal-tunnel/x402-sdk/erc8004'
 *
 * const publicClient = createPublicClient({ chain: base, transport: http() })
 * const registry = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient })
 * const agent = await registry.getAgent(1n)
 * ```
 */
export function createIdentityRegistryClient(
  config: CreateIdentityRegistryClientConfig,
): IdentityRegistryClient {
  const address = config.address ?? ERC8004_ADDRESSES[config.chainId].identityRegistry
  const publicClient = config.publicClient
  const chainId = config.chainId

  async function readString(
    functionName: 'tokenURI',
    agentId: bigint,
    opts: ReadOptions | undefined,
  ): Promise<string> {
    try {
      const result = await publicClient.readContract({
        address,
        abi: identityRegistryAbi,
        functionName,
        args: [agentId],
        ...(opts?.blockTag !== undefined && { blockTag: opts.blockTag }),
      })
      return result as string
    } catch (err) {
      throw new IdentityLookupError({
        agentId,
        ...(err instanceof Error && { cause: err }),
      })
    }
  }

  async function readAddress(
    functionName: 'getAgentWallet' | 'ownerOf',
    agentId: bigint,
    opts: ReadOptions | undefined,
  ): Promise<Address> {
    try {
      const result = await publicClient.readContract({
        address,
        abi: identityRegistryAbi,
        functionName,
        args: [agentId],
        ...(opts?.blockTag !== undefined && { blockTag: opts.blockTag }),
      })
      return result as Address
    } catch (err) {
      throw new IdentityLookupError({
        agentId,
        ...(err instanceof Error && { cause: err }),
      })
    }
  }

  return {
    address,
    chainId,

    async getAgent(agentId, opts) {
      const [agentURI, agentWallet, owner] = await Promise.all([
        readString('tokenURI', agentId, opts),
        readAddress('getAgentWallet', agentId, opts),
        readAddress('ownerOf', agentId, opts),
      ])
      return { agentId, agentURI, agentWallet, owner }
    },

    getAgentURI(agentId, opts) {
      return readString('tokenURI', agentId, opts)
    },

    getAgentWallet(agentId, opts) {
      return readAddress('getAgentWallet', agentId, opts)
    },

    getOwner(agentId, opts) {
      return readAddress('ownerOf', agentId, opts)
    },

    async getMetadata(agentId, key, opts) {
      try {
        const result = await publicClient.readContract({
          address,
          abi: identityRegistryAbi,
          functionName: 'getMetadata',
          args: [agentId, key],
          ...(opts?.blockTag !== undefined && { blockTag: opts.blockTag }),
        })
        return result as Hex
      } catch (err) {
        throw new IdentityLookupError({
          agentId,
          ...(err instanceof Error && { cause: err }),
        })
      }
    },

    async register(args, opts) {
      const signerAccount = args.signer.account
      if (signerAccount === undefined) {
        throw new RegistrationError({
          step: 'registry',
          cause: new Error('signer has no account attached'),
        })
      }

      let txHash: Hex
      try {
        // viem's writeContract with overloaded ABI picks by args.length; we
        // dispatch explicitly so TS narrowing is unambiguous.
        txHash =
          args.agentURI === undefined
            ? await args.signer.writeContract({
                address,
                abi: identityRegistryAbi,
                functionName: 'register',
                args: [],
                account: signerAccount,
                chain: args.signer.chain ?? null,
              })
            : await args.signer.writeContract({
                address,
                abi: identityRegistryAbi,
                functionName: 'register',
                args: [args.agentURI],
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
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
          confirmations: opts?.confirmations ?? 1,
          ...(opts?.timeoutMs !== undefined && { timeout: opts.timeoutMs }),
        })
        const agentId = extractAgentIdFromRegisteredEvent(receipt.logs)
        return { agentId, txHash }
      } catch (err) {
        throw new RegistrationError({
          step: 'receipt',
          ...(err instanceof Error && { cause: err }),
        })
      }
    },

    async setAgentURI(args, opts) {
      const signerAccount = args.signer.account
      if (signerAccount === undefined) {
        throw new RegistrationError({
          step: 'registry',
          cause: new Error('signer has no account attached'),
        })
      }
      const txHash = await args.signer.writeContract({
        address,
        abi: identityRegistryAbi,
        functionName: 'setAgentURI',
        args: [args.agentId, args.agentURI],
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

    async setMetadata(args, opts) {
      const signerAccount = args.signer.account
      if (signerAccount === undefined) {
        throw new RegistrationError({
          step: 'registry',
          cause: new Error('signer has no account attached'),
        })
      }
      const txHash = await args.signer.writeContract({
        address,
        abi: identityRegistryAbi,
        functionName: 'setMetadata',
        args: [args.agentId, args.key, args.value],
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

/**
 * Parse the `agentId` from a registration transaction receipt. Reads the
 * first `Registered` log's indexed `agentId` topic directly instead of
 * full-log decoding — robust against receipts that include unrelated logs
 * (e.g. ERC-721 `Transfer`) whose non-indexed data can't be decoded with the
 * Registered ABI.
 */
const REGISTERED_TOPIC: Hex = toEventSelector('Registered(uint256,string,address)')

function extractAgentIdFromRegisteredEvent(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
): bigint {
  for (const log of logs) {
    if (log.topics[0] === REGISTERED_TOPIC && log.topics[1] !== undefined) {
      return BigInt(log.topics[1])
    }
  }
  throw new Error('Registered event not found in transaction receipt')
}
