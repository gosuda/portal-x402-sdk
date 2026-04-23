import { getAddress, isAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  ERC8004_ADDRESSES,
  ERC8004_CHAIN_NAMES,
  ERC8004_SPEC_VERSION,
  type Erc8004ChainId,
} from './addresses'

const CHAIN_IDS: readonly Erc8004ChainId[] = ['eip155:1', 'eip155:8453', 'eip155:84532']

describe('ERC8004_ADDRESSES', () => {
  it('exposes every supported chain with non-empty identity + reputation addresses', () => {
    for (const chainId of CHAIN_IDS) {
      const bundle = ERC8004_ADDRESSES[chainId]
      expect(bundle.identityRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(bundle.reputationRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
  })

  it('addresses are EIP-55 checksummed (viem.isAddress strict mode)', () => {
    for (const chainId of CHAIN_IDS) {
      const bundle = ERC8004_ADDRESSES[chainId]
      expect(isAddress(bundle.identityRegistry, { strict: true })).toBe(true)
      expect(isAddress(bundle.reputationRegistry, { strict: true })).toBe(true)
      // Double-check: our literal is already the checksummed form.
      expect(bundle.identityRegistry).toBe(getAddress(bundle.identityRegistry))
      expect(bundle.reputationRegistry).toBe(getAddress(bundle.reputationRegistry))
    }
  })

  it('Ethereum mainnet and Base mainnet share the same vanity (CREATE2 deterministic)', () => {
    expect(ERC8004_ADDRESSES['eip155:1'].identityRegistry).toBe(
      ERC8004_ADDRESSES['eip155:8453'].identityRegistry,
    )
    expect(ERC8004_ADDRESSES['eip155:1'].reputationRegistry).toBe(
      ERC8004_ADDRESSES['eip155:8453'].reputationRegistry,
    )
  })

  it('Base Sepolia uses a separate testnet vanity (not shared with mainnet)', () => {
    expect(ERC8004_ADDRESSES['eip155:84532'].identityRegistry).not.toBe(
      ERC8004_ADDRESSES['eip155:1'].identityRegistry,
    )
    expect(ERC8004_ADDRESSES['eip155:84532'].reputationRegistry).not.toBe(
      ERC8004_ADDRESSES['eip155:1'].reputationRegistry,
    )
  })

  it('all addresses use the 0x8004... vanity prefix', () => {
    for (const chainId of CHAIN_IDS) {
      const bundle = ERC8004_ADDRESSES[chainId]
      expect(bundle.identityRegistry.toLowerCase().startsWith('0x8004')).toBe(true)
      expect(bundle.reputationRegistry.toLowerCase().startsWith('0x8004')).toBe(true)
    }
  })
})

describe('ERC8004_CHAIN_NAMES', () => {
  it('has a display name for every supported chain', () => {
    for (const chainId of CHAIN_IDS) {
      expect(ERC8004_CHAIN_NAMES[chainId]).toMatch(/\w+/)
    }
  })
})

describe('ERC8004_SPEC_VERSION', () => {
  it('is a semver string', () => {
    expect(ERC8004_SPEC_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
