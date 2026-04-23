import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'
import { IdentityLookupError, RegistrationError } from '../errors'
import { reputationRegistryAbi } from './abi'
import { ERC8004_ADDRESSES } from './addresses'
import {
  createReputationRegistryClient,
  type ReputationReadClient,
  type ReputationWriteClient,
} from './reputation-registry'

const REPUTATION_ADDR = ERC8004_ADDRESSES['eip155:8453'].reputationRegistry
const TEST_ACCOUNT = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)

type PublicMock = {
  readContract: ReturnType<typeof vi.fn>
  waitForTransactionReceipt: ReturnType<typeof vi.fn>
}
type WalletMock = {
  account: typeof TEST_ACCOUNT | undefined
  chain: null
  writeContract: ReturnType<typeof vi.fn>
}

function makeReadClient(overrides: Partial<PublicMock> = {}): ReputationReadClient & PublicMock {
  return {
    readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    ...overrides,
  } as ReputationReadClient & PublicMock
}
function makeWriteClient(overrides: Partial<WalletMock> = {}): ReputationWriteClient & WalletMock {
  return {
    account: TEST_ACCOUNT,
    chain: null,
    writeContract: vi.fn(),
    ...overrides,
  } as ReputationWriteClient & WalletMock
}

describe('createReputationRegistryClient — shape', () => {
  it('resolves the canonical Base mainnet reputation address', () => {
    const client = createReputationRegistryClient({
      chainId: 'eip155:8453',
      publicClient: makeReadClient(),
    })
    expect(client.address).toBe(REPUTATION_ADDR)
    expect(client.chainId).toBe('eip155:8453')
  })
})

describe('createReputationRegistryClient — reads', () => {
  it('readFeedback unpacks the 5-tuple into a named record', async () => {
    const pub = makeReadClient({
      readContract: vi.fn().mockResolvedValue([100n, 2, 'uptime', '', false] as const),
    })
    const client = createReputationRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    const entry = await client.readFeedback({
      agentId: 1n,
      clientAddress: '0x0000000000000000000000000000000000000001',
      feedbackIndex: 0n,
    })
    expect(entry).toEqual({
      value: 100n,
      valueDecimals: 2,
      tag1: 'uptime',
      tag2: '',
      isRevoked: false,
    })
    expect(pub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: REPUTATION_ADDR,
        abi: reputationRegistryAbi,
        functionName: 'readFeedback',
        args: [1n, '0x0000000000000000000000000000000000000001', 0n],
      }),
    )
  })

  it('getSummary unpacks the 3-tuple', async () => {
    const pub = makeReadClient({
      readContract: vi.fn().mockResolvedValue([3n, 125n, 2] as const),
    })
    const client = createReputationRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    const summary = await client.getSummary({
      agentId: 1n,
      clientAddresses: ['0x0000000000000000000000000000000000000001'],
      tag1: 'uptime',
      tag2: '',
    })
    expect(summary).toEqual({ count: 3n, summaryValue: 125n, summaryValueDecimals: 2 })
    expect(pub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'getSummary',
        args: [1n, ['0x0000000000000000000000000000000000000001'], 'uptime', ''],
      }),
    )
  })

  it('wraps read failures in IdentityLookupError with agentId + cause', async () => {
    const underlying = new Error('revert')
    const pub = makeReadClient({ readContract: vi.fn().mockRejectedValue(underlying) })
    const client = createReputationRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    try {
      await client.getSummary({ agentId: 55n, clientAddresses: [], tag1: '', tag2: '' })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(IdentityLookupError)
      if (err instanceof IdentityLookupError) {
        expect(err.agentId).toBe(55n)
        expect(err.cause).toBe(underlying)
      }
    }
  })
})

describe('createReputationRegistryClient — writes', () => {
  const TX_HASH: Hex = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'

  it('giveFeedback forwards all eight args to writeContract', async () => {
    const wallet = makeWriteClient({ writeContract: vi.fn().mockResolvedValue(TX_HASH) })
    const pub = makeReadClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    })
    const client = createReputationRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    const result = await client.giveFeedback({
      agentId: 7n,
      value: 450n,
      valueDecimals: 2,
      tag1: 'uptime',
      tag2: '',
      endpoint: 'https://api.example/ping',
      feedbackURI: 'ipfs://QmFeedback',
      feedbackHash: '0xdeadbeef'.padEnd(66, '0') as Hex,
      signer: wallet,
    })
    expect(result.txHash).toBe(TX_HASH)
    expect(wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'giveFeedback',
        args: [
          7n,
          450n,
          2,
          'uptime',
          '',
          'https://api.example/ping',
          'ipfs://QmFeedback',
          '0xdeadbeef'.padEnd(66, '0'),
        ],
      }),
    )
  })

  it('revokeFeedback forwards agentId + feedbackIndex', async () => {
    const wallet = makeWriteClient({ writeContract: vi.fn().mockResolvedValue(TX_HASH) })
    const pub = makeReadClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    })
    const client = createReputationRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    await client.revokeFeedback({ agentId: 7n, feedbackIndex: 3n, signer: wallet })
    expect(wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'revokeFeedback', args: [7n, 3n] }),
    )
  })

  it('wraps writeContract failure in RegistrationError step=registry', async () => {
    const wallet = makeWriteClient({
      writeContract: vi.fn().mockRejectedValue(new Error('user rejected')),
    })
    const pub = makeReadClient()
    const client = createReputationRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    try {
      await client.giveFeedback({
        agentId: 1n,
        value: 100n,
        valueDecimals: 2,
        tag1: '',
        tag2: '',
        endpoint: '',
        feedbackURI: '',
        feedbackHash: '0x'.padEnd(66, '0') as Hex,
        signer: wallet,
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RegistrationError)
      if (err instanceof RegistrationError) {
        expect(err.step).toBe('registry')
      }
    }
  })

  it('rejects a signer without an account', async () => {
    const wallet = makeWriteClient({ account: undefined, writeContract: vi.fn() })
    const pub = makeReadClient()
    const client = createReputationRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    await expect(
      client.revokeFeedback({ agentId: 1n, feedbackIndex: 0n, signer: wallet }),
    ).rejects.toBeInstanceOf(RegistrationError)
  })
})
