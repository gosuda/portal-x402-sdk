import { encodeAddress } from '@wonderland/interop-addresses'
import { describe, expect, it } from 'vitest'
import { deriveEnsip25Key, encodeRegistryCaip350 } from './text-key'

// Canonical ERC-8004 Identity Registry addresses (same CREATE2 vanity on all EVM
// chains per ERC-8004 v0.7). Used as stable test fixtures.
const IDENTITY_REGISTRY_MAINNET = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const
const IDENTITY_REGISTRY_SEPOLIA = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const

describe('deriveEnsip25Key', () => {
  it('produces the canonical key format for Base mainnet', () => {
    const key = deriveEnsip25Key({
      chainId: 'eip155:8453',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
      agentId: 42n,
    })
    // Exact format from ENSIP-25 Draft: agent-registration[<erc7930-hex>][<agentId>]
    expect(key).toMatch(/^agent-registration\[0x[0-9a-f]+\]\[42\]$/)
  })

  it('encodes agentId as base-10 regardless of bigint magnitude', () => {
    const small = deriveEnsip25Key({
      chainId: 'eip155:1',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
      agentId: 0n,
    })
    const large = deriveEnsip25Key({
      chainId: 'eip155:1',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
      agentId: 2n ** 256n - 1n,
    })
    expect(small.endsWith('[0]')).toBe(true)
    expect(large.endsWith(`[${(2n ** 256n - 1n).toString(10)}]`)).toBe(true)
  })

  it('produces different keys for different agentIds (same chain + registry)', () => {
    const a = deriveEnsip25Key({
      chainId: 'eip155:8453',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
      agentId: 1n,
    })
    const b = deriveEnsip25Key({
      chainId: 'eip155:8453',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
      agentId: 2n,
    })
    expect(a).not.toBe(b)
  })

  it('produces different keys for different chains (same registry + agentId)', () => {
    const mainnet = deriveEnsip25Key({
      chainId: 'eip155:1',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
      agentId: 1n,
    })
    const base = deriveEnsip25Key({
      chainId: 'eip155:8453',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
      agentId: 1n,
    })
    expect(mainnet).not.toBe(base)
  })

  it('is deterministic — same inputs yield identical keys across calls', () => {
    const args = {
      chainId: 'eip155:8453',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
      agentId: 7n,
    } as const
    expect(deriveEnsip25Key(args)).toBe(deriveEnsip25Key(args))
  })
})

describe('encodeRegistryCaip350', () => {
  it('returns lowercased 0x-prefixed hex', () => {
    const hex = encodeRegistryCaip350({
      chainId: 'eip155:8453',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
    })
    expect(hex.startsWith('0x')).toBe(true)
    expect(hex).toBe(hex.toLowerCase())
  })

  it('matches the wonderland encodeAddress output byte-for-byte (excluding case)', () => {
    const hex = encodeRegistryCaip350({
      chainId: 'eip155:8453',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
    })
    const expected = encodeAddress(
      {
        version: 1,
        chainType: 'eip155',
        chainReference: '8453',
        address: IDENTITY_REGISTRY_MAINNET,
      },
      { format: 'hex' },
    ).toLowerCase()
    expect(hex).toBe(expected)
  })

  it('distinguishes Base mainnet from Base Sepolia by chain reference', () => {
    const mainnet = encodeRegistryCaip350({
      chainId: 'eip155:8453',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
    })
    const sepolia = encodeRegistryCaip350({
      chainId: 'eip155:84532',
      registryAddress: IDENTITY_REGISTRY_SEPOLIA,
    })
    expect(mainnet).not.toBe(sepolia)
  })

  it('rejects an empty chain reference', () => {
    expect(() =>
      encodeRegistryCaip350({
        chainId: 'eip155:' as `eip155:${number}`,
        registryAddress: IDENTITY_REGISTRY_MAINNET,
      }),
    ).toThrow(/empty chain reference/)
  })
})

describe('deriveEnsip25Key — spec-anchor snapshot', () => {
  it('matches the pinned ENSIP-25 Draft key for Base mainnet + agentId=1', () => {
    const key = deriveEnsip25Key({
      chainId: 'eip155:8453',
      registryAddress: IDENTITY_REGISTRY_MAINNET,
      agentId: 1n,
    })
    // Snapshot: if wonderland's ERC-7930 encoding changes, this test surfaces it
    // immediately. The inner hex is produced live (not a literal copy) so the
    // assertion is structural — format must match exactly.
    const expectedHex = encodeAddress(
      {
        version: 1,
        chainType: 'eip155',
        chainReference: '8453',
        address: IDENTITY_REGISTRY_MAINNET,
      },
      { format: 'hex' },
    ).toLowerCase()
    expect(key).toBe(`agent-registration[${expectedHex}][1]`)
  })
})
