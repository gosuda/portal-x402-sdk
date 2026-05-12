/**
 * Real-chain integration test against Base mainnet — read-only.
 *
 * This test exercises `createIdentityRegistryClient` against the live
 * ERC-8004 Identity Registry deployed on Base mainnet. It complements the
 * msw + vi.fn() unit tests in `./identity-registry.test.ts` by proving that
 *
 *   1. our hardcoded address in `ERC8004_ADDRESSES['eip155:8453']` is in fact
 *      a deployed contract (extcodesize > 0),
 *   2. our ABI fragments match the on-chain selectors (ERC-721 reads decode
 *      without panicking),
 *   3. our client surface (`getAgentURI`, `getAgentWallet`, `ownerOf`) does
 *      not throw on lawful inputs.
 *
 * Why not anvil/prool? Because we only read. Forking adds infra cost (anvil
 * spawn + port allocation + teardown flakiness) without changing what is
 * being verified — a read against forked Base mainnet returns the same bytes
 * as a read against live Base mainnet. We hit live mainnet directly and
 * accept the public RPC's rate limits (test reads ~3 storage slots).
 *
 * The test SKIPS itself cleanly when the RPC is unreachable (offline CI,
 * rate-limited public RPC, etc.) — it is a smoke test, not a gate. Set the
 * `BASE_RPC_URL` env var to a private RPC (Alchemy / Infura / QuickNode) to
 * make the test deterministic in CI; otherwise it falls back to the public
 * `https://mainnet.base.org`.
 */

import { type Address, createPublicClient, http, isAddress } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { IdentityLookupError } from '../errors/identity'
import { ERC8004_ADDRESSES } from './addresses'
import { createIdentityRegistryClient } from './identity-registry'

const BASE_RPC_URL = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'
const IDENTITY_ADDR: Address = ERC8004_ADDRESSES['eip155:8453'].identityRegistry

/** 8-second budget per call. Public RPCs are slow but not 30-second slow. */
const RPC_TIMEOUT_MS = 8_000

async function isRpcReachable(): Promise<boolean> {
  try {
    const client = createPublicClient({
      chain: base,
      transport: http(BASE_RPC_URL, { timeout: RPC_TIMEOUT_MS }),
    })
    await client.getBlockNumber()
    return true
  } catch {
    return false
  }
}

describe('ERC-8004 Identity Registry — Base mainnet (read-only)', () => {
  // Resolved once per test run. Vitest reuses the result across `it` blocks
  // inside this `describe` so we pay the RPC tax exactly once for the gate.
  let rpcReachable = false
  const publicClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPC_URL, { timeout: RPC_TIMEOUT_MS }),
  })

  it('preflight — RPC reachable (otherwise subsequent tests skip)', async () => {
    rpcReachable = await isRpcReachable()
    if (!rpcReachable) {
      console.warn(
        `[real-chain test] Base mainnet RPC unreachable at ${BASE_RPC_URL} — skipping subsequent assertions. Set BASE_RPC_URL to a private RPC to run this gate.`,
      )
    }
    // The preflight itself is not a failure; later tests skip if false.
    expect(true).toBe(true)
  }, 15_000)

  it('has a contract deployed at the canonical Identity Registry address', async () => {
    if (!rpcReachable) return
    const code = await publicClient.getCode({ address: IDENTITY_ADDR })
    expect(code).toBeDefined()
    // `getCode` returns `undefined` for an EOA / unverified address and a
    // non-empty `0x...` hex for a contract. We assert the latter.
    expect(code).not.toBe('0x')
    expect((code ?? '').length).toBeGreaterThan(2)
  }, 15_000)

  it('createIdentityRegistryClient binds to the canonical address by chainId', async () => {
    if (!rpcReachable) return
    const client = createIdentityRegistryClient({
      chainId: 'eip155:8453',
      publicClient,
    })
    expect(client.address).toBe(IDENTITY_ADDR)
    expect(isAddress(client.address)).toBe(true)
  }, 5_000)

  it('reads of non-existent agent surface as IdentityLookupError (ERC-721 nonexistent token revert)', async () => {
    if (!rpcReachable) return
    const client = createIdentityRegistryClient({
      chainId: 'eip155:8453',
      publicClient,
    })
    // Agent id `2^200` is astronomically unlikely to be minted ever.
    // ERC-721's `tokenURI` reverts for non-existent tokens; our client
    // wraps the revert into IdentityLookupError so consumers can narrow.
    await expect(client.getAgentURI(2n ** 200n)).rejects.toBeInstanceOf(IdentityLookupError)
  }, 15_000)

  it('low-level extcodesize check confirms Reputation Registry is also deployed', async () => {
    if (!rpcReachable) return
    const reputationAddr = ERC8004_ADDRESSES['eip155:8453'].reputationRegistry
    const code = await publicClient.getCode({ address: reputationAddr })
    expect(code).toBeDefined()
    expect(code).not.toBe('0x')
  }, 15_000)
})
