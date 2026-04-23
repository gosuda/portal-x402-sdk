import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRecord, IdentityRegistryClient } from '../erc8004/identity-registry'
import { RelayVerificationError } from '../errors'
import { crossCheckEnsip25, type EnsTextReader } from './bidirectional'
import { deriveEnsip25Key } from './text-key'

const REGISTRY_ADDR: Address = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
const AGENT_WALLET: Address = '0x000000000000000000000000000000000000bEEF'
const NFT_OWNER: Address = '0x0000000000000000000000000000000000000C0De'

function makeEnsReader(value: string | null): EnsTextReader & {
  getEnsText: ReturnType<typeof vi.fn>
} {
  return {
    getEnsText: vi.fn().mockResolvedValue(value),
  } as EnsTextReader & { getEnsText: ReturnType<typeof vi.fn> }
}

function makeIdentityRegistry(agent: AgentRecord): IdentityRegistryClient {
  return {
    address: REGISTRY_ADDR,
    chainId: 'eip155:8453',
    getAgent: vi.fn().mockResolvedValue(agent),
    getAgentURI: vi.fn(),
    getAgentWallet: vi.fn(),
    getOwner: vi.fn(),
    getMetadata: vi.fn(),
    register: vi.fn(),
    setAgentURI: vi.fn(),
    setMetadata: vi.fn(),
  }
}

describe('crossCheckEnsip25 — happy path', () => {
  it('returns the agent record when ENS text value is "1" and the on-chain id exists', async () => {
    const ens = makeEnsReader('1')
    const registry = makeIdentityRegistry({
      agentId: 42n,
      agentURI: 'ipfs://QmAlice',
      agentWallet: AGENT_WALLET,
      owner: NFT_OWNER,
    })

    const result = await crossCheckEnsip25({
      ensName: 'alice.eth',
      expectedAgentId: 42n,
      chainId: 'eip155:8453',
      registryAddress: REGISTRY_ADDR,
      publicClient: ens,
      identityRegistry: registry,
    })

    expect(result).toEqual({
      agentId: 42n,
      agentDomain: 'alice.eth',
      agentAddress: AGENT_WALLET,
    })

    // ENS was queried with exactly the ENSIP-25 key for this (chain, registry, agentId).
    const expectedKey = deriveEnsip25Key({
      chainId: 'eip155:8453',
      registryAddress: REGISTRY_ADDR,
      agentId: 42n,
    })
    expect(ens.getEnsText).toHaveBeenCalledWith({ name: 'alice.eth', key: expectedKey })
  })
})

describe('crossCheckEnsip25 — ENS side failures', () => {
  it('throws ensip25-mismatch when the text record is missing (null)', async () => {
    const ens = makeEnsReader(null)
    const registry = makeIdentityRegistry({
      agentId: 1n,
      agentURI: 'ipfs://x',
      agentWallet: AGENT_WALLET,
      owner: AGENT_WALLET,
    })
    try {
      await crossCheckEnsip25({
        ensName: 'nope.eth',
        expectedAgentId: 1n,
        chainId: 'eip155:8453',
        registryAddress: REGISTRY_ADDR,
        publicClient: ens,
        identityRegistry: registry,
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayVerificationError)
      if (err instanceof RelayVerificationError) {
        expect(err.reason).toBe('ensip25-mismatch')
        expect(err.host).toBe('nope.eth')
      }
    }
  })

  it('throws ensip25-mismatch when the text record is a wrong value', async () => {
    const ens = makeEnsReader('')
    const registry = makeIdentityRegistry({
      agentId: 1n,
      agentURI: 'ipfs://x',
      agentWallet: AGENT_WALLET,
      owner: AGENT_WALLET,
    })
    await expect(
      crossCheckEnsip25({
        ensName: 'wrong.eth',
        expectedAgentId: 1n,
        chainId: 'eip155:8453',
        registryAddress: REGISTRY_ADDR,
        publicClient: ens,
        identityRegistry: registry,
      }),
    ).rejects.toBeInstanceOf(RelayVerificationError)
  })

  it('wraps an ENS lookup exception into ensip25-mismatch with cause', async () => {
    const underlying = new Error('resolver unreachable')
    const ens: EnsTextReader & { getEnsText: ReturnType<typeof vi.fn> } = {
      getEnsText: vi.fn().mockRejectedValue(underlying),
    } as EnsTextReader & { getEnsText: ReturnType<typeof vi.fn> }
    const registry = makeIdentityRegistry({
      agentId: 1n,
      agentURI: 'ipfs://x',
      agentWallet: AGENT_WALLET,
      owner: AGENT_WALLET,
    })
    try {
      await crossCheckEnsip25({
        ensName: 'alice.eth',
        expectedAgentId: 1n,
        chainId: 'eip155:8453',
        registryAddress: REGISTRY_ADDR,
        publicClient: ens,
        identityRegistry: registry,
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayVerificationError)
      if (err instanceof RelayVerificationError) {
        expect(err.reason).toBe('ensip25-mismatch')
        expect(err.cause).toBe(underlying)
      }
    }
  })
})

describe('crossCheckEnsip25 — on-chain side', () => {
  it('propagates IdentityRegistry getAgent failures unchanged', async () => {
    const ens = makeEnsReader('1')
    const registry: IdentityRegistryClient = {
      address: REGISTRY_ADDR,
      chainId: 'eip155:8453',
      getAgent: vi.fn().mockRejectedValue(new Error('agent not found')),
      getAgentURI: vi.fn(),
      getAgentWallet: vi.fn(),
      getOwner: vi.fn(),
      getMetadata: vi.fn(),
      register: vi.fn(),
      setAgentURI: vi.fn(),
      setMetadata: vi.fn(),
    }
    await expect(
      crossCheckEnsip25({
        ensName: 'alice.eth',
        expectedAgentId: 42n,
        chainId: 'eip155:8453',
        registryAddress: REGISTRY_ADDR,
        publicClient: ens,
        identityRegistry: registry,
      }),
    ).rejects.toThrow(/agent not found/)
  })
})
