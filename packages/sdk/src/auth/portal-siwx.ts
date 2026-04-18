import {
  type CompleteSIWxInfo,
  createSIWxMessage,
  createSIWxPayload,
  type EVMMessageVerifier,
  type EVMSigner,
  type SIWxPayload,
  verifySIWxSignature,
} from '@x402/extensions/sign-in-with-x'
import type { Address, PublicClient } from 'viem'
import { generateSiweNonce } from 'viem/siwe'

const DEFAULT_CHAIN_ID = 'eip155:8453' as const
const DEFAULT_VERSION = '1'
const DEFAULT_EXPIRATION_SEC = 600

/** Portal SIWX configuration — set once per factory, reused across signs/verifies. */
export type PortalSiwxConfig = {
  /** Server domain (e.g. `'app.example.com'`). */
  domain: string
  /** Full resource URI (e.g. `'https://app.example.com/portal'`). */
  uri: string
  /** CAIP-2 chain id. Default `'eip155:8453'` (Base mainnet). */
  chainId?: `eip155:${number}`
  /** Human-readable purpose shown in the signed message. */
  statement?: string
  /** CAIP-122 version. Default `'1'`. */
  version?: string
  /** Expiration in seconds after issuance. Default `600` (10 minutes). */
  expirationSec?: number
  /** Optional CAIP-122 resources list. */
  resources?: string[]
}

/** Options when signing a fresh challenge. */
export type PortalSiwxSignOptions = {
  /** Consumer EOA or smart wallet address. */
  address: Address
  /** EVM signer (viem `WalletClient`, `PrivateKeyAccount`, or any `{ signMessage }` implementation). */
  signer: EVMSigner
  /**
   * Optional deterministic nonce (useful for tests). Must be alphanumeric per
   * SIWE/EIP-4361 ABNF. Default: `viem/siwe generateSiweNonce()`.
   */
  nonce?: string
  /** Optional correlation id (CAIP-122 `requestId`). */
  requestId?: string
}

/** Options when verifying a SIWX payload. */
export type PortalSiwxVerifyOptions = {
  /** Signed payload returned by `sign()` (or parsed from a wire header). */
  payload: SIWxPayload
  /** Optional viem `PublicClient` — enables EIP-1271 + EIP-6492 smart wallet verification. */
  publicClient?: PublicClient
}

/** Result of `buildMessage()` — raw message string plus the complete info bundle for consumers who want to sign elsewhere. */
export type PortalSiwxMessage = {
  message: string
  info: CompleteSIWxInfo
}

/** Portal SIWX factory — ergonomic wrapper over `@x402/extensions/sign-in-with-x`. */
export interface PortalSiwxAuth {
  /** Build a fresh message without signing (for external signer flows). */
  buildMessage(args: Omit<PortalSiwxSignOptions, 'signer'>): PortalSiwxMessage
  /** Build a fresh challenge, sign it, and return the complete SIWX payload. */
  sign(args: PortalSiwxSignOptions): Promise<SIWxPayload>
  /** Verify a SIWX payload. EOA-only by default; pass `publicClient` for EIP-1271 + EIP-6492. */
  verify(args: PortalSiwxVerifyOptions): Promise<boolean>
}

/** Create a Portal SIWX client. All returned methods use the config provided here. */
export function createPortalSiwx(config: PortalSiwxConfig): PortalSiwxAuth {
  const chainId = config.chainId ?? DEFAULT_CHAIN_ID
  const version = config.version ?? DEFAULT_VERSION
  const expirationSec = config.expirationSec ?? DEFAULT_EXPIRATION_SEC

  function buildInfo(args: Omit<PortalSiwxSignOptions, 'signer'>): CompleteSIWxInfo {
    const now = new Date()
    const info: CompleteSIWxInfo = {
      domain: config.domain,
      uri: config.uri,
      version,
      nonce: args.nonce ?? generateSiweNonce(),
      issuedAt: now.toISOString(),
      expirationTime: new Date(now.getTime() + expirationSec * 1000).toISOString(),
      chainId,
      type: 'eip191',
    }
    if (config.statement !== undefined) info.statement = config.statement
    if (config.resources !== undefined) info.resources = config.resources
    if (args.requestId !== undefined) info.requestId = args.requestId
    return info
  }

  return {
    buildMessage(args) {
      const info = buildInfo(args)
      const message = createSIWxMessage(info, args.address)
      return { message, info }
    },

    async sign(args) {
      const info = buildInfo(args)
      return createSIWxPayload(info, args.signer)
    },

    async verify(args) {
      if (args.publicClient === undefined) {
        const result = await verifySIWxSignature(args.payload)
        return result.valid === true
      }
      const { publicClient } = args
      const evmVerifier: EVMMessageVerifier = ({ address, message, signature }) =>
        publicClient.verifyMessage({ address, message, signature })
      const result = await verifySIWxSignature(args.payload, { evmVerifier })
      return result.valid === true
    },
  }
}
