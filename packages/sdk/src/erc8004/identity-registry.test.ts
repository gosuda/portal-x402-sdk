import { type Address, encodeEventTopics, type Hex, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'
import { IdentityLookupError, RegistrationError } from '../errors'
import { identityRegistryAbi } from './abi'
import { ERC8004_ADDRESSES } from './addresses'
import {
  createIdentityRegistryClient,
  type IdentityReadClient,
  type IdentityWriteClient,
} from './identity-registry'

const IDENTITY_ADDR = ERC8004_ADDRESSES['eip155:8453'].identityRegistry
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

function makeReadClient(overrides: Partial<PublicMock> = {}): IdentityReadClient & PublicMock {
  return {
    readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    ...overrides,
  } as IdentityReadClient & PublicMock
}
function makeWriteClient(overrides: Partial<WalletMock> = {}): IdentityWriteClient & WalletMock {
  return {
    account: TEST_ACCOUNT,
    chain: null,
    writeContract: vi.fn(),
    ...overrides,
  } as IdentityWriteClient & WalletMock
}

describe('createIdentityRegistryClient — shape', () => {
  it('resolves the canonical Base mainnet address from the literal chainId', () => {
    const client = createIdentityRegistryClient({
      chainId: 'eip155:8453',
      publicClient: makeReadClient(),
    })
    expect(client.address).toBe(IDENTITY_ADDR)
    expect(client.chainId).toBe('eip155:8453')
  })

  it('honors address override (for anvil / local deployment)', () => {
    const custom: Address = '0x0000000000000000000000000000000000000042'
    const client = createIdentityRegistryClient({
      chainId: 'eip155:8453',
      publicClient: makeReadClient(),
      address: custom,
    })
    expect(client.address).toBe(custom)
  })
})

describe('createIdentityRegistryClient — reads', () => {
  it('getAgentURI calls tokenURI with agentId', async () => {
    const pub = makeReadClient({ readContract: vi.fn().mockResolvedValue('ipfs://QmAbc') })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    expect(await client.getAgentURI(42n)).toBe('ipfs://QmAbc')
    expect(pub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: IDENTITY_ADDR,
        abi: identityRegistryAbi,
        functionName: 'tokenURI',
        args: [42n],
      }),
    )
  })

  it('getAgentWallet calls getAgentWallet with agentId', async () => {
    const agentWallet: Address = '0x000000000000000000000000000000000000bEEF'
    const pub = makeReadClient({ readContract: vi.fn().mockResolvedValue(agentWallet) })
    const client = createIdentityRegistryClient({ chainId: 'eip155:1', publicClient: pub })
    expect(await client.getAgentWallet(7n)).toBe(agentWallet)
    expect(pub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'getAgentWallet', args: [7n] }),
    )
  })

  it('getOwner calls ERC-721 ownerOf', async () => {
    const owner: Address = '0x0000000000000000000000000000000000000c0De'
    const pub = makeReadClient({ readContract: vi.fn().mockResolvedValue(owner) })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    expect(await client.getOwner(1n)).toBe(owner)
    expect(pub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'ownerOf', args: [1n] }),
    )
  })

  it('getAgent fans out tokenURI + getAgentWallet + ownerOf and bundles them', async () => {
    const agentWallet: Address = '0x000000000000000000000000000000000000bEEF'
    const owner: Address = '0x0000000000000000000000000000000000000c0De'
    const readContract = vi.fn(({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'tokenURI':
          return Promise.resolve('ipfs://QmAgent')
        case 'getAgentWallet':
          return Promise.resolve(agentWallet)
        case 'ownerOf':
          return Promise.resolve(owner)
        default:
          throw new Error(`unexpected functionName ${functionName}`)
      }
    })
    const pub = makeReadClient({ readContract })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    expect(await client.getAgent(99n)).toEqual({
      agentId: 99n,
      agentURI: 'ipfs://QmAgent',
      agentWallet,
      owner,
    })
    expect(pub.readContract).toHaveBeenCalledTimes(3)
  })

  it('wraps read failures in IdentityLookupError with cause + agentId', async () => {
    const underlying = new Error('rpc down')
    const pub = makeReadClient({ readContract: vi.fn().mockRejectedValue(underlying) })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    try {
      await client.getAgentURI(123n)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(IdentityLookupError)
      if (err instanceof IdentityLookupError) {
        expect(err.agentId).toBe(123n)
        expect(err.cause).toBe(underlying)
      }
    }
  })

  it('forwards blockTag when provided', async () => {
    const pub = makeReadClient({ readContract: vi.fn().mockResolvedValue('ipfs://x') })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    await client.getAgentURI(1n, { blockTag: 'finalized' })
    expect(pub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ blockTag: 'finalized' }),
    )
  })
})

describe('createIdentityRegistryClient — register', () => {
  const TX_HASH: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  function makeRegisteredReceipt(agentId: bigint, owner: Address) {
    const [, topic1, topic2] = encodeEventTopics({
      abi: identityRegistryAbi,
      eventName: 'Registered',
      args: { agentId, owner },
    })
    return {
      transactionHash: TX_HASH,
      status: 'success' as const,
      logs: [
        {
          address: IDENTITY_ADDR,
          topics: [
            keccak256(toHex('Registered(uint256,string,address)')),
            topic1 ?? '0x',
            topic2 ?? '0x',
          ],
          // agentURI (string) is non-indexed data; the decoder accepts '0x' for
          // an empty URI which is valid for the no-arg register() overload.
          data: '0x' as Hex,
        },
      ],
    }
  }

  it('calls the no-arg register() overload when agentURI is undefined', async () => {
    const wallet = makeWriteClient({ writeContract: vi.fn().mockResolvedValue(TX_HASH) })
    const pub = makeReadClient({
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValue(makeRegisteredReceipt(5n, TEST_ACCOUNT.address)),
    })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    const result = await client.register({ signer: wallet })
    expect(result.txHash).toBe(TX_HASH)
    expect(result.agentId).toBe(5n)
    expect(wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'register', args: [] }),
    )
  })

  it('calls register(string) overload when agentURI is provided', async () => {
    const wallet = makeWriteClient({ writeContract: vi.fn().mockResolvedValue(TX_HASH) })
    const pub = makeReadClient({
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValue(makeRegisteredReceipt(10n, TEST_ACCOUNT.address)),
    })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    await client.register({ agentURI: 'ipfs://QmXyz', signer: wallet })
    expect(wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'register', args: ['ipfs://QmXyz'] }),
    )
  })

  it('wraps writeContract failure as RegistrationError step=registry', async () => {
    const wallet = makeWriteClient({
      writeContract: vi.fn().mockRejectedValue(new Error('user rejected')),
    })
    const pub = makeReadClient()
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    try {
      await client.register({ agentURI: 'ipfs://x', signer: wallet })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RegistrationError)
      if (err instanceof RegistrationError) {
        expect(err.step).toBe('registry')
      }
    }
  })

  it('wraps receipt failure as RegistrationError step=receipt', async () => {
    const wallet = makeWriteClient({ writeContract: vi.fn().mockResolvedValue(TX_HASH) })
    const pub = makeReadClient({
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('timeout')),
    })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    try {
      await client.register({ agentURI: 'ipfs://x', signer: wallet })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RegistrationError)
      if (err instanceof RegistrationError) {
        expect(err.step).toBe('receipt')
      }
    }
  })

  it('rejects a signer without an account', async () => {
    const wallet = makeWriteClient({ account: undefined, writeContract: vi.fn() })
    const pub = makeReadClient()
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    await expect(client.register({ agentURI: 'ipfs://x', signer: wallet })).rejects.toBeInstanceOf(
      RegistrationError,
    )
    expect(wallet.writeContract).not.toHaveBeenCalled()
  })
})

describe('createIdentityRegistryClient — writes (setAgentURI / setMetadata)', () => {
  const TX_HASH: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  it('setAgentURI calls writeContract with the right args and waits for receipt', async () => {
    const wallet = makeWriteClient({ writeContract: vi.fn().mockResolvedValue(TX_HASH) })
    const pub = makeReadClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    const result = await client.setAgentURI({
      agentId: 3n,
      agentURI: 'ipfs://QmNew',
      signer: wallet,
    })
    expect(result).toEqual({ txHash: TX_HASH })
    expect(wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'setAgentURI', args: [3n, 'ipfs://QmNew'] }),
    )
    expect(pub.waitForTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ hash: TX_HASH, confirmations: 1 }),
    )
  })

  it('setMetadata calls writeContract with the right args', async () => {
    const wallet = makeWriteClient({ writeContract: vi.fn().mockResolvedValue(TX_HASH) })
    const pub = makeReadClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    })
    const client = createIdentityRegistryClient({ chainId: 'eip155:8453', publicClient: pub })
    await client.setMetadata({
      agentId: 9n,
      key: 'homepage',
      value: '0xdeadbeef' as Hex,
      signer: wallet,
    })
    expect(wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'setMetadata',
        args: [9n, 'homepage', '0xdeadbeef'],
      }),
    )
  })
})
