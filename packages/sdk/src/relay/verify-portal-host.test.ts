import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRecord, IdentityRegistryClient } from '../erc8004/identity-registry'
import { RelayVerificationError } from '../errors'
import type { RelayDescriptor } from './discovery'
import { type EnsResolverClient, verifyPortalHost } from './verify-portal-host'

const REGISTRY_ADDR: Address = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
const AGENT_WALLET: Address = '0x000000000000000000000000000000000000bEEF'
const DIFFERENT_ADDR: Address = '0x0000000000000000000000000000000000000DeaD'

function makeDescriptor(overrides: Partial<RelayDescriptor> = {}): RelayDescriptor {
  const issued = new Date('2026-04-19T10:00:00Z')
  const expires = new Date('2026-04-19T11:00:00Z')
  return {
    address: AGENT_WALLET,
    version: 'v2.1.7',
    issuedAt: issued,
    issuedAtNano: BigInt(issued.getTime()) * 1_000_000n,
    expiresAt: expires,
    expiresAtNano: BigInt(expires.getTime()) * 1_000_000n,
    apiHttpsAddr: 'https://relay-a.example.com',
    wireGuardPublicKey: '',
    wireGuardPort: 0,
    supportsOverlay: false,
    supportsUdp: false,
    supportsTcp: true,
    activeConnections: 0,
    tcpBps: 0,
    signature: '',
    ...overrides,
  }
}

function makeEnsClient(
  overrides: Partial<{
    getEnsName: ReturnType<typeof vi.fn>
    getEnsText: ReturnType<typeof vi.fn>
  }> = {},
): EnsResolverClient {
  return {
    getEnsName: vi.fn().mockResolvedValue('alice.eth'),
    getEnsText: vi.fn().mockResolvedValue('1'),
    ...overrides,
  } as EnsResolverClient
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

const BASE_ARGS = {
  descriptor: makeDescriptor(),
  host: 'relay-a.example.com',
  expectedAgentId: 42n,
  chainId: 'eip155:8453',
  registryAddress: REGISTRY_ADDR,
} as const

describe('verifyPortalHost — happy path', () => {
  it('returns the verified record when all three explicit layers pass', async () => {
    const ens = makeEnsClient()
    const registry = makeIdentityRegistry({
      agentId: 42n,
      agentURI: 'ipfs://QmAlice',
      agentWallet: AGENT_WALLET,
      owner: AGENT_WALLET,
    })

    const result = await verifyPortalHost({
      ...BASE_ARGS,
      ensClient: ens,
      identityRegistry: registry,
    })

    expect(result).toEqual({
      host: BASE_ARGS.host,
      ensName: 'alice.eth',
      agentId: 42n,
      agentAddress: AGENT_WALLET,
      trustAnchors: ['ensip25'],
    })
  })
})

describe('verifyPortalHost — Layer 2 (ENS reverse)', () => {
  it('throws ens-mismatch when getEnsName returns null', async () => {
    const ens = makeEnsClient({
      getEnsName: vi.fn().mockResolvedValue(null),
    })
    const registry = makeIdentityRegistry({
      agentId: 42n,
      agentURI: 'ipfs://x',
      agentWallet: AGENT_WALLET,
      owner: AGENT_WALLET,
    })
    try {
      await verifyPortalHost({
        ...BASE_ARGS,
        ensClient: ens,
        identityRegistry: registry,
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayVerificationError)
      if (err instanceof RelayVerificationError) {
        expect(err.reason).toBe('ens-mismatch')
      }
    }
  })

  it('wraps getEnsName exception as ens-mismatch with cause', async () => {
    const underlying = new Error('resolver down')
    const ens = makeEnsClient({
      getEnsName: vi.fn().mockRejectedValue(underlying),
    })
    const registry = makeIdentityRegistry({
      agentId: 42n,
      agentURI: 'ipfs://x',
      agentWallet: AGENT_WALLET,
      owner: AGENT_WALLET,
    })
    try {
      await verifyPortalHost({
        ...BASE_ARGS,
        ensClient: ens,
        identityRegistry: registry,
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayVerificationError)
      if (err instanceof RelayVerificationError) {
        expect(err.reason).toBe('ens-mismatch')
        expect(err.cause).toBe(underlying)
      }
    }
  })
})

describe('verifyPortalHost — Layer 3 (ERC-8004)', () => {
  it('throws erc8004-missing when identity registry read fails', async () => {
    const ens = makeEnsClient()
    const registry: IdentityRegistryClient = {
      address: REGISTRY_ADDR,
      chainId: 'eip155:8453',
      getAgent: vi.fn().mockRejectedValue(new Error('revert')),
      getAgentURI: vi.fn(),
      getAgentWallet: vi.fn(),
      getOwner: vi.fn(),
      getMetadata: vi.fn(),
      register: vi.fn(),
      setAgentURI: vi.fn(),
      setMetadata: vi.fn(),
    }
    try {
      await verifyPortalHost({
        ...BASE_ARGS,
        ensClient: ens,
        identityRegistry: registry,
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayVerificationError)
      if (err instanceof RelayVerificationError) {
        expect(err.reason).toBe('erc8004-missing')
      }
    }
  })

  it('throws erc8004-missing when the descriptor address does not match agentWallet', async () => {
    const ens = makeEnsClient()
    const registry = makeIdentityRegistry({
      agentId: 42n,
      agentURI: 'ipfs://x',
      agentWallet: DIFFERENT_ADDR,
      owner: DIFFERENT_ADDR,
    })
    try {
      await verifyPortalHost({
        ...BASE_ARGS,
        ensClient: ens,
        identityRegistry: registry,
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayVerificationError)
      if (err instanceof RelayVerificationError) {
        expect(err.reason).toBe('erc8004-missing')
      }
    }
  })
})

describe('verifyPortalHost — Layer 4 (default ENSIP-25 anchor)', () => {
  it('throws ensip25-mismatch when the text record is missing', async () => {
    const ens = makeEnsClient({
      getEnsText: vi.fn().mockResolvedValue(null),
    })
    const registry = makeIdentityRegistry({
      agentId: 42n,
      agentURI: 'ipfs://x',
      agentWallet: AGENT_WALLET,
      owner: AGENT_WALLET,
    })
    try {
      await verifyPortalHost({
        ...BASE_ARGS,
        ensClient: ens,
        identityRegistry: registry,
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayVerificationError)
      if (err instanceof RelayVerificationError) {
        expect(err.reason).toBe('ensip25-mismatch')
      }
    }
  })
})

describe('verifyPortalHost — Layer 4 (pluggable trust anchors)', () => {
  function freshRegistry() {
    return makeIdentityRegistry({
      agentId: 42n,
      agentURI: 'ipfs://x',
      agentWallet: AGENT_WALLET,
      owner: AGENT_WALLET,
    })
  }

  it('runs each supplied anchor in order and reports their names in the result', async () => {
    const ordered: string[] = []
    const first = { name: 'first', verify: vi.fn(async () => void ordered.push('first')) }
    const second = { name: 'second', verify: vi.fn(async () => void ordered.push('second')) }

    const result = await verifyPortalHost({
      ...BASE_ARGS,
      ensClient: makeEnsClient(),
      identityRegistry: freshRegistry(),
      trustAnchors: [first, second],
    })

    expect(result.trustAnchors).toEqual(['first', 'second'])
    expect(ordered).toEqual(['first', 'second'])
    expect(first.verify).toHaveBeenCalledTimes(1)
    expect(second.verify).toHaveBeenCalledTimes(1)
  })

  it('fails fast when any anchor rejects', async () => {
    const ok = { name: 'ok', verify: vi.fn(async () => undefined) }
    const boom = {
      name: 'boom',
      verify: vi.fn(async () => {
        throw new RelayVerificationError({
          host: BASE_ARGS.host,
          reason: 'ensip25-mismatch',
          metaMessages: ['custom'],
        })
      }),
    }
    const never = { name: 'never', verify: vi.fn(async () => undefined) }

    await expect(
      verifyPortalHost({
        ...BASE_ARGS,
        ensClient: makeEnsClient(),
        identityRegistry: freshRegistry(),
        trustAnchors: [ok, boom, never],
      }),
    ).rejects.toMatchObject({ reason: 'ensip25-mismatch' })
    expect(ok.verify).toHaveBeenCalledTimes(1)
    expect(boom.verify).toHaveBeenCalledTimes(1)
    expect(never.verify).not.toHaveBeenCalled()
  })

  it('skips Layer 4 entirely when an empty anchor list is supplied', async () => {
    // Anchor-free mode is intentionally supported — an advanced caller who
    // already proved the ENS↔agent link elsewhere can skip the cross-check.
    const ens = makeEnsClient({
      getEnsText: vi.fn().mockResolvedValue(null),
    })
    const result = await verifyPortalHost({
      ...BASE_ARGS,
      ensClient: ens,
      identityRegistry: freshRegistry(),
      trustAnchors: [],
    })
    expect(result.trustAnchors).toEqual([])
    expect(ens.getEnsText).not.toHaveBeenCalled()
  })
})
