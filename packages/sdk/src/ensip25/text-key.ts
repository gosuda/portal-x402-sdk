/**
 * ENSIP-25 text record key derivation + ERC-7930 encoding.
 *
 * Spec (Draft): the agent announces ERC-8004 registration under an ENS text
 * record with key `agent-registration[<erc7930-hex>][<agentId-decimal>]` and
 * value `"1"`. The `<erc7930-hex>` half is the lower-case hex of the ERC-7930
 * binary encoding of the registry's CAIP-10 identifier (chain + address).
 *
 * Pure, synchronous, deterministic — same inputs always produce the same key.
 *
 * Wonderland API anchor (verified against `@wonderland/interop-addresses@0.5.x`):
 *   encodeAddress(
 *     { version, chainType: 'eip155', chainReference: '<decimal>', address: '0x...' },
 *     { format: 'hex' },
 *   ) -> 0x...
 * The symbol name drifted across minor versions — if a future bump renames
 * `encodeAddress`, update this one file and the spec-anchor test will fail loudly.
 */

import { encodeAddress } from '@wonderland/interop-addresses'
import type { Address } from 'viem'

/** CAIP-2 chain id restricted to the EIP-155 namespace (EVM chains). */
export type Eip155ChainId = `eip155:${number}`

/** Inputs to {@link deriveEnsip25Key} and {@link encodeRegistryCaip350}. */
export type RegistryLocator = {
  /** CAIP-2 chain id, e.g. `'eip155:8453'` for Base mainnet. */
  chainId: Eip155ChainId
  /** ERC-8004 Identity Registry contract address on that chain. */
  registryAddress: Address
}

/**
 * Derives the canonical ENSIP-25 text record key.
 *
 * @example
 * ```ts
 * deriveEnsip25Key({
 *   chainId: 'eip155:8453',
 *   registryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
 *   agentId: 42n,
 * })
 * // 'agent-registration[0x...][42]'
 * ```
 */
export function deriveEnsip25Key(args: RegistryLocator & { agentId: bigint }): string {
  const encoded = encodeRegistryCaip350({
    chainId: args.chainId,
    registryAddress: args.registryAddress,
  })
  return `agent-registration[${encoded}][${args.agentId.toString(10)}]`
}

/**
 * Lower-cased hex of the ERC-7930 binary encoding of `<chainId>:<registryAddress>`.
 * Exposed separately so consumers can inspect the encoded bytes without rebuilding
 * the full ENSIP-25 key.
 */
export function encodeRegistryCaip350(args: RegistryLocator): `0x${string}` {
  const chainReference = extractChainReference(args.chainId)
  const hex = encodeAddress(
    {
      version: 1,
      chainType: 'eip155',
      chainReference,
      address: args.registryAddress,
    },
    { format: 'hex' },
  )
  return hex.toLowerCase() as `0x${string}`
}

function extractChainReference(chainId: Eip155ChainId): string {
  const colonIndex = chainId.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(`invalid CAIP-2 chainId (missing namespace separator): ${chainId}`)
  }
  const reference = chainId.slice(colonIndex + 1)
  if (reference.length === 0) {
    throw new Error(`invalid CAIP-2 chainId (empty chain reference): ${chainId}`)
  }
  return reference
}
