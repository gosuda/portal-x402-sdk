/**
 * End-to-end write test against an anvil fork of Base mainnet.
 *
 * Spawns a local anvil process that forks Base mainnet, then exercises the
 * full `createIdentityRegistryClient.register()` flow against the real
 * ERC-8004 Identity Registry bytecode. This is the only place we test the
 * write path against deployed contract code — the rest of the suite uses
 * `vi.fn()` mocks or read-only live mainnet calls.
 *
 * What this proves that the unit tests don't:
 *   - Our calldata encoding matches the on-chain function selectors.
 *   - The contract accepts the call (no `require` revert in the `register`
 *     entrypoint when given a valid agentURI string).
 *   - The receipt-parsing path returns a valid `agentId` extracted from the
 *     `Registered` event.
 *
 * The test SKIPS itself if anvil is not installed OR the fork URL is
 * unreachable — it's a smoke test, not a gate.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { createPublicClient, createWalletClient, type Hex, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ERC8004_ADDRESSES } from './addresses'
import { createIdentityRegistryClient } from './identity-registry'

const BASE_RPC_URL = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'
const ANVIL_BIN = process.env.ANVIL_BIN ?? `${process.env.HOME}/.foundry/bin/anvil`
const READY_POLL_INTERVAL_MS = 250
const READY_TIMEOUT_MS = 30_000
// anvil's deterministic dev account #0 — public, never holds real value.
const ANVIL_DEV_PRIVATE_KEY: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_ACCOUNT = privateKeyToAccount(ANVIL_DEV_PRIVATE_KEY)

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, () => {
      const addr = server.address()
      server.close(() => {
        if (typeof addr === 'object' && addr !== null) {
          resolve(addr.port)
        } else {
          reject(new Error('failed to acquire port'))
        }
      })
    })
  })
}

async function isAnvilReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    })
    if (!res.ok) return false
    const body = (await res.json()) as { result?: string; error?: unknown }
    return typeof body.result === 'string'
  } catch {
    return false
  }
}

async function waitUntilReady(url: string, deadlineMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    if (await isAnvilReady(url)) return true
    await sleep(READY_POLL_INTERVAL_MS)
  }
  return false
}

const anvilInstalled = existsSync(ANVIL_BIN)

describe.skipIf(!anvilInstalled)(
  'ERC-8004 Identity Registry — anvil fork of Base mainnet (write)',
  () => {
    let anvilProcess: ChildProcess | undefined
    let rpcUrl = ''
    let forkReady = false

    beforeAll(async () => {
      const port = await pickFreePort()
      rpcUrl = `http://127.0.0.1:${port}`
      anvilProcess = spawn(
        ANVIL_BIN,
        ['--fork-url', BASE_RPC_URL, '--port', String(port), '--host', '127.0.0.1', '--silent'],
        { stdio: 'ignore' },
      )
      anvilProcess.on('error', () => {
        // Spawn failed (binary missing, permission, etc.). Tests skip via
        // the forkReady guard below.
      })
      forkReady = await waitUntilReady(rpcUrl, READY_TIMEOUT_MS)
      if (!forkReady) {
        console.warn(
          `[anvil test] anvil did not become ready at ${rpcUrl} within ${READY_TIMEOUT_MS}ms (BASE_RPC_URL=${BASE_RPC_URL}). Skipping write assertions.`,
        )
      }
    }, READY_TIMEOUT_MS + 5_000)

    afterAll(async () => {
      if (anvilProcess !== undefined && anvilProcess.exitCode === null) {
        anvilProcess.kill('SIGTERM')
        // Give it 2 seconds to exit gracefully, then SIGKILL.
        await sleep(2_000)
        if (anvilProcess.exitCode === null) anvilProcess.kill('SIGKILL')
      }
    })

    it('register(agentURI) submits a tx that mints a new agent NFT', async () => {
      if (!forkReady) return

      const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) })
      const walletClient = createWalletClient({
        account: TEST_ACCOUNT,
        chain: base,
        transport: http(rpcUrl),
      })

      // anvil_setBalance: top up the dev account so the tx pays gas without
      // needing the real Base mainnet balance.
      await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'anvil_setBalance',
          params: [TEST_ACCOUNT.address, `0x${parseEther('10').toString(16)}`],
          id: 1,
        }),
      })

      // anvil_setCode: clear any contract code that exists at the anvil dev
      // address on the forked chain. anvil's deterministic dev keys are
      // public, so people have deployed code at these addresses on real
      // mainnets — that code would otherwise execute as the `to` of
      // `onERC721Received` during ERC-721 `_safeMint`, frequently reverting
      // the outer call. Wiping the code makes the account a true EOA for
      // this test.
      await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'anvil_setCode',
          params: [TEST_ACCOUNT.address, '0x'],
          id: 2,
        }),
      })

      // anvil_setNonce: reset the nonce. The forked chain may show this
      // address has a huge nonce from real-world activity by other people
      // who used the public dev key — viem's nonce pickup would otherwise
      // pin an unexpectedly-high value that diverges from the post-tx
      // expectation in `getAgentURI` round-trip checks.
      await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'anvil_setNonce',
          params: [TEST_ACCOUNT.address, '0x0'],
          id: 3,
        }),
      })

      const client = createIdentityRegistryClient({
        chainId: 'eip155:8453',
        publicClient,
      })

      const agentURI = 'ipfs://QmTestAnvilFork0123456789abcdefghijklmnop'
      const result = await client.register(
        { agentURI, signer: walletClient },
        { confirmations: 1, timeoutMs: 20_000 },
      )

      // Receipt parsing returns a positive agentId from the `Registered`
      // event topic decode.
      expect(result.agentId).toBeGreaterThanOrEqual(0n)
      expect(result.txHash.startsWith('0x')).toBe(true)
      expect(result.txHash.length).toBe(66)

      // Round-trip: the URI we wrote can be read back.
      const readBack = await client.getAgentURI(result.agentId)
      expect(readBack).toBe(agentURI)

      // Owner is the wallet we registered with.
      const owner = await client.getOwner(result.agentId)
      expect(owner.toLowerCase()).toBe(TEST_ACCOUNT.address.toLowerCase())
    }, 60_000)

    it('canonical address matches what anvil sees as deployed', async () => {
      if (!forkReady) return
      const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) })
      const code = await publicClient.getCode({
        address: ERC8004_ADDRESSES['eip155:8453'].identityRegistry,
      })
      expect(code).toBeDefined()
      expect(code).not.toBe('0x')
    }, 15_000)
  },
)
