import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { createPortalSiwx } from './portal-siwx'

// Deterministic fixture account. Private key is a well-known test key — never used for real funds.
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const account = privateKeyToAccount(TEST_PRIVATE_KEY)

const baseConfig = {
  domain: 'app.example.com',
  uri: 'https://app.example.com/portal',
  statement: 'Sign in to Portal',
} as const

describe('createPortalSiwx — defaults', () => {
  it('defaults chainId to eip155:8453 (Base mainnet) when not provided', async () => {
    const siwx = createPortalSiwx(baseConfig)
    const payload = await siwx.sign({ address: account.address, signer: account })
    expect(payload.chainId).toBe('eip155:8453')
    expect(payload.type).toBe('eip191')
  })

  it('honors explicit chainId override', async () => {
    const siwx = createPortalSiwx({ ...baseConfig, chainId: 'eip155:84532' })
    const payload = await siwx.sign({ address: account.address, signer: account })
    expect(payload.chainId).toBe('eip155:84532')
  })

  it('sets issuedAt + expirationTime using expirationSec (default 600 = 10 min)', async () => {
    const siwx = createPortalSiwx(baseConfig)
    const payload = await siwx.sign({ address: account.address, signer: account })
    const issued = Date.parse(payload.issuedAt)
    const expires = Date.parse(payload.expirationTime ?? '')
    expect(Number.isFinite(issued)).toBe(true)
    expect(Number.isFinite(expires)).toBe(true)
    expect(expires - issued).toBe(600_000)
  })

  it('honors expirationSec override', async () => {
    const siwx = createPortalSiwx({ ...baseConfig, expirationSec: 30 })
    const payload = await siwx.sign({ address: account.address, signer: account })
    const issued = Date.parse(payload.issuedAt)
    const expires = Date.parse(payload.expirationTime ?? '')
    expect(expires - issued).toBe(30_000)
  })
})

describe('createPortalSiwx — sign + verify roundtrip', () => {
  it('signs a payload that verifies successfully (EOA)', async () => {
    const siwx = createPortalSiwx(baseConfig)
    const payload = await siwx.sign({ address: account.address, signer: account })

    expect(payload.address.toLowerCase()).toBe(account.address.toLowerCase())
    expect(payload.domain).toBe(baseConfig.domain)
    expect(payload.uri).toBe(baseConfig.uri)
    expect(payload.statement).toBe(baseConfig.statement)
    expect(payload.signature.startsWith('0x')).toBe(true)

    const ok = await siwx.verify({ payload })
    expect(ok).toBe(true)
  })

  it('rejects a tampered signature', async () => {
    const siwx = createPortalSiwx(baseConfig)
    const payload = await siwx.sign({ address: account.address, signer: account })

    // Flip a single hex character in the signature
    const tampered = {
      ...payload,
      signature: payload.signature.replace(/.$/, (c) => (c === '0' ? '1' : '0')),
    }
    const ok = await siwx.verify({ payload: tampered })
    expect(ok).toBe(false)
  })

  it('rejects a payload whose address does not match the signature', async () => {
    const siwx = createPortalSiwx(baseConfig)
    const payload = await siwx.sign({ address: account.address, signer: account })

    const differentAddress = '0x0000000000000000000000000000000000000001' as const
    const swapped = { ...payload, address: differentAddress }
    const ok = await siwx.verify({ payload: swapped })
    expect(ok).toBe(false)
  })
})

describe('createPortalSiwx — nonce + requestId + resources', () => {
  it('uses a fresh nonce on each sign when not provided', async () => {
    const siwx = createPortalSiwx(baseConfig)
    const a = await siwx.sign({ address: account.address, signer: account })
    const b = await siwx.sign({ address: account.address, signer: account })
    expect(a.nonce).not.toBe(b.nonce)
  })

  it('honors explicit nonce override', async () => {
    const siwx = createPortalSiwx(baseConfig)
    const payload = await siwx.sign({
      address: account.address,
      signer: account,
      nonce: 'deterministicNonce123',
    })
    expect(payload.nonce).toBe('deterministicNonce123')
  })

  it('honors explicit requestId', async () => {
    const siwx = createPortalSiwx(baseConfig)
    const payload = await siwx.sign({
      address: account.address,
      signer: account,
      requestId: 'reqAbc',
    })
    expect(payload.requestId).toBe('reqAbc')
  })

  it('propagates resources from config into the signed payload', async () => {
    const resources = ['https://app.example.com/api/premium']
    const siwx = createPortalSiwx({ ...baseConfig, resources })
    const payload = await siwx.sign({ address: account.address, signer: account })
    expect(payload.resources).toEqual(resources)
  })
})

describe('createPortalSiwx — buildMessage', () => {
  it('produces a CAIP-122 compliant message string for external signers', () => {
    const siwx = createPortalSiwx(baseConfig)
    const { message, info } = siwx.buildMessage({
      address: account.address,
      nonce: 'fixedNonce123',
    })

    // CAIP-122 header line (SIWE format for eip155 namespace).
    expect(message).toContain('app.example.com wants you to sign in with your Ethereum account')
    expect(message).toContain(account.address)
    expect(message).toContain('Sign in to Portal')
    expect(message).toContain('URI: https://app.example.com/portal')
    expect(message).toContain('Nonce: fixedNonce123')

    // Info bundle mirrors the message fields.
    expect(info.domain).toBe(baseConfig.domain)
    expect(info.chainId).toBe('eip155:8453')
    expect(info.nonce).toBe('fixedNonce123')
  })
})
