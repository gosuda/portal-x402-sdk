import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRecord, IdentityRegistryClient } from '../erc8004/identity-registry'
import { RelayVerificationError } from '../errors/relay'
import { ensip25TrustAnchor, type TrustAnchor, type TrustAnchorContext } from './trust-anchor'

const REGISTRY_ADDR: Address = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
const AGENT_WALLET: Address = '0x000000000000000000000000000000000000bEEF'

function makeContext(overrides: Partial<TrustAnchorContext> = {}): TrustAnchorContext {
  const agent: AgentRecord = {
    agentId: 42n,
    agentURI: 'ipfs://x',
    agentWallet: AGENT_WALLET,
    owner: AGENT_WALLET,
  }
  const identityRegistry: IdentityRegistryClient = {
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
  return {
    host: 'relay.test.example',
    ensName: 'alice.eth',
    expectedAgentId: 42n,
    advertisedAddress: AGENT_WALLET,
    ensClient: {
      getEnsName: vi.fn().mockResolvedValue('alice.eth'),
      getEnsText: vi.fn().mockResolvedValue('1'),
      // biome-ignore lint/suspicious/noExplicitAny: test-only narrow cast
    } as any,
    identityRegistry,
    ...overrides,
  }
}

describe('ensip25TrustAnchor', () => {
  it('exposes a stable name', () => {
    const anchor = ensip25TrustAnchor({
      chainId: 'eip155:8453',
      registryAddress: REGISTRY_ADDR,
    })
    expect(anchor.name).toBe('ensip25')
  })

  it('passes when the ENSIP-25 cross-check succeeds', async () => {
    const anchor = ensip25TrustAnchor({
      chainId: 'eip155:8453',
      registryAddress: REGISTRY_ADDR,
    })
    await expect(anchor.verify(makeContext())).resolves.toBeUndefined()
  })

  it('surfaces RelayVerificationError when the text record is missing', async () => {
    const anchor = ensip25TrustAnchor({
      chainId: 'eip155:8453',
      registryAddress: REGISTRY_ADDR,
    })
    const ctx = makeContext({
      ensClient: {
        getEnsName: vi.fn().mockResolvedValue('alice.eth'),
        getEnsText: vi.fn().mockResolvedValue(null),
        // biome-ignore lint/suspicious/noExplicitAny: test-only narrow cast
      } as any,
    })
    await expect(anchor.verify(ctx)).rejects.toBeInstanceOf(RelayVerificationError)
  })
})

describe('TrustAnchor composition contract', () => {
  it('a custom anchor can short-circuit with its own RelayVerificationError', async () => {
    const custom: TrustAnchor = {
      name: 'custom-test',
      async verify(context) {
        if (context.ensName !== 'expected.eth') {
          throw new RelayVerificationError({
            host: context.host,
            reason: 'ensip25-mismatch',
            metaMessages: ['custom anchor rejected'],
          })
        }
      },
    }
    await expect(custom.verify(makeContext())).rejects.toMatchObject({
      reason: 'ensip25-mismatch',
    })
    await expect(custom.verify(makeContext({ ensName: 'expected.eth' }))).resolves.toBeUndefined()
  })
})
