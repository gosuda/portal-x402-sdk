/**
 * Canonical ERC-8004 registry addresses (CREATE2 deterministic).
 *
 * The Identity and Reputation registries share the same vanity address across
 * Ethereum + Base mainnet (same CREATE2 salt + bytecode), and a separate
 * vanity on Base Sepolia. Adding a new chain is an ADR-level change: the
 * literal-union key type below means the compiler refuses any chain we
 * haven't explicitly opted in to.
 *
 * Source: ERC-8004 v2.0 deployment records. If upstream re-deploys at a new
 * address (v3+), this map changes alongside the `ERC8004_SPEC_VERSION` bump.
 */
export const ERC8004_SPEC_VERSION = '2.0.0' as const

/** Supported EIP-155 chains. Narrow literal union — adding a chain is explicit. */
export type Erc8004ChainId = 'eip155:1' | 'eip155:8453' | 'eip155:84532'

export type Erc8004AddressBundle = {
  readonly identityRegistry: `0x${string}`
  readonly reputationRegistry: `0x${string}`
}

export const ERC8004_ADDRESSES: {
  readonly [K in Erc8004ChainId]: Erc8004AddressBundle
} = {
  /** Ethereum mainnet. */
  'eip155:1': {
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
  /** Base mainnet. Same vanity as Ethereum mainnet (same CREATE2 salt + bytecode). */
  'eip155:8453': {
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
  /** Base Sepolia — separate testnet vanity. */
  'eip155:84532': {
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  },
} as const

/** Human-readable display names for logging / error messages. */
export const ERC8004_CHAIN_NAMES: { readonly [K in Erc8004ChainId]: string } = {
  'eip155:1': 'Ethereum mainnet',
  'eip155:8453': 'Base mainnet',
  'eip155:84532': 'Base Sepolia',
} as const
