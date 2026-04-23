/**
 * `relay-register` CLI — one-shot ERC-8004 agent registration for relay
 * operators.
 *
 * Pipeline: validate inputs → submit `register(agentURI)` on the Identity
 * Registry → wait for the transaction receipt → print the minted `agentId`.
 * The IPFS pinning step is deliberately the caller's job: run your pinner
 * of choice (Pinata / Kubo / Helia / portal-tunnel hosted) against the
 * registration file first, then pass `--agent-uri ipfs://<cid>` here. That
 * keeps the SDK vendor-neutral and the CLI focused on the one action it
 * has a unique signing key for.
 *
 * Private key policy: always read from `--private-key-env <name>` (env var
 * name, not value). Never accept the key as a flag value; flag arguments
 * leak into shell history, CI logs, and `ps` output. The CLI refuses to
 * start if the named env var is empty.
 */

import { cac } from 'cac'
import { createPublicClient, createWalletClient, type Hex, http, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, mainnet } from 'viem/chains'
import type { Erc8004ChainId } from '../erc8004/addresses'
import { createIdentityRegistryClient } from '../erc8004/identity-registry'
import { RegistrationError } from '../errors/identity'

const CLI_NAME = 'relay-register'

type CliOptions = {
  chain: 'mainnet' | 'base' | 'base-sepolia'
  privateKeyEnv: string
  agentUri?: string
  rpcUrl?: string
  confirmations?: number
}

type ResolvedChain = {
  chainId: Erc8004ChainId
  viemChain: typeof mainnet | typeof base | typeof baseSepolia
  defaultRpc: string
}

const CHAIN_ALIASES: Readonly<Record<CliOptions['chain'], ResolvedChain>> = {
  mainnet: { chainId: 'eip155:1', viemChain: mainnet, defaultRpc: 'https://eth.llamarpc.com' },
  base: { chainId: 'eip155:8453', viemChain: base, defaultRpc: 'https://mainnet.base.org' },
  'base-sepolia': {
    chainId: 'eip155:84532',
    viemChain: baseSepolia,
    defaultRpc: 'https://sepolia.base.org',
  },
}

function cli() {
  const program = cac(CLI_NAME)

  program
    .command('', 'Register an ERC-8004 agent on the chosen chain')
    .option('--chain <chain>', 'Target chain: mainnet | base | base-sepolia', {
      default: 'base',
    })
    .option('--private-key-env <name>', 'Env var holding the 0x-prefixed private key', {
      default: 'AGENT_PRIVATE_KEY',
    })
    .option(
      '--agent-uri <uri>',
      'Off-chain agent URI (ipfs://<cid> or https://...). Omit for the no-arg register() overload.',
    )
    .option('--rpc-url <url>', 'Override the default RPC endpoint for the chosen chain')
    .option('--confirmations <n>', 'Receipt confirmations to wait for', { default: 1 })
    .action(async (_, options: CliOptions) => {
      await run(options)
    })

  program.help()
  program.version('0.0.0')
  program.parse(process.argv, { run: false })
  return program
}

async function run(options: CliOptions): Promise<void> {
  const chain = CHAIN_ALIASES[options.chain]
  if (chain === undefined) {
    throw usageError(
      `unknown --chain ${options.chain}. Expected one of: mainnet, base, base-sepolia.`,
    )
  }

  const privateKey = readPrivateKeyFromEnv(options.privateKeyEnv)
  const account = privateKeyToAccount(privateKey)
  const rpcUrl = options.rpcUrl ?? chain.defaultRpc

  const publicClient = createPublicClient({ chain: chain.viemChain, transport: http(rpcUrl) })
  const walletClient = createWalletClient({
    account,
    chain: chain.viemChain,
    transport: http(rpcUrl),
  })

  const registry = createIdentityRegistryClient({
    chainId: chain.chainId,
    publicClient,
  })

  console.log(`[${CLI_NAME}] Registering on ${options.chain} (${chain.chainId})`)
  console.log(`[${CLI_NAME}]   signer: ${account.address}`)
  console.log(`[${CLI_NAME}]   registry: ${registry.address}`)
  if (options.agentUri !== undefined) {
    console.log(`[${CLI_NAME}]   agentURI: ${options.agentUri}`)
  }

  const registerArgs: Parameters<typeof registry.register>[0] =
    options.agentUri !== undefined
      ? { agentURI: options.agentUri, signer: walletClient }
      : { signer: walletClient }

  const { agentId, txHash } = await registry.register(registerArgs, {
    confirmations: Number(options.confirmations ?? 1),
  })

  console.log(`[${CLI_NAME}] Registered!`)
  console.log(`[${CLI_NAME}]   agentId: ${agentId}`)
  console.log(`[${CLI_NAME}]   txHash: ${txHash}`)
}

function readPrivateKeyFromEnv(envName: string): Hex {
  const raw = process.env[envName]
  if (raw === undefined || raw.trim().length === 0) {
    throw usageError(`env var ${envName} is empty; pass the 0x-prefixed private key there`)
  }
  const trimmed = raw.trim()
  if (!isHex(trimmed, { strict: true })) {
    throw usageError(`env var ${envName} is not a valid 0x-prefixed hex string`)
  }
  return trimmed as Hex
}

function usageError(message: string): Error {
  return new RegistrationError({ step: 'registry', cause: new Error(message) })
}

// Entrypoint. Lazy so this module remains importable for tests without
// running argv parsing.
if (process.argv[1]?.endsWith('relay-register.mjs')) {
  cli()
}

// Exports for unit testing the pure helpers.
export { CHAIN_ALIASES, cli, readPrivateKeyFromEnv, run }
