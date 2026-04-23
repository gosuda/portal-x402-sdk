import { bytesToHex, type Hex, hexToBytes } from 'viem'
import { privateKeyToAddress, sign } from 'viem/accounts'
import { sha256 as viemSha256 } from 'viem/utils'
import { describe, expect, it } from 'vitest'
import { RelayVerificationError } from '../errors/relay'
import { relayDescriptorCanonicalBytes } from './canonical-bytes'
import type { RelayDescriptor } from './discovery'
import { verifyRelayDescriptorSignature } from './verify-signature'

// Deterministic test key — not a real relay key.
const TEST_PRIVATE_KEY: Hex = '0x1111111111111111111111111111111111111111111111111111111111111111'
const TEST_ADDRESS = privateKeyToAddress(TEST_PRIVATE_KEY)

function baseDescriptor(overrides: Partial<RelayDescriptor> = {}): RelayDescriptor {
  const issued = new Date('2026-04-19T10:00:00Z')
  const expires = new Date('2026-04-19T11:00:00Z')
  return {
    address: TEST_ADDRESS,
    version: 'v2.1.7',
    issuedAt: issued,
    issuedAtNano: BigInt(issued.getTime()) * 1_000_000n,
    expiresAt: expires,
    expiresAtNano: BigInt(expires.getTime()) * 1_000_000n,
    apiHttpsAddr: 'https://relay.test.example',
    wireGuardPublicKey: '',
    wireGuardPort: 0,
    supportsOverlay: false,
    supportsUdp: false,
    supportsTcp: true,
    activeConnections: 7,
    tcpBps: 1024,
    signature: '',
    ...overrides,
  }
}

/**
 * Mirror the Go signing flow so we can exercise verifyRelayDescriptorSignature
 * in a round-trip: SHA-256 canonical bytes, secp256k1 sign, pack as
 * `[v(1) | r(32) | s(32)]`, base64-StdEncoding.
 */
async function signDescriptor(
  descriptor: RelayDescriptor,
  privateKey: Hex,
): Promise<RelayDescriptor> {
  const cleared = { ...descriptor, signature: '' }
  const canonical = relayDescriptorCanonicalBytes(cleared)
  const digest = viemSha256(bytesToHex(canonical) as Hex)
  const sig = await sign({ hash: digest, privateKey })
  const rBytes = hexToBytes(sig.r as Hex, { size: 32 })
  const sBytes = hexToBytes(sig.s as Hex, { size: 32 })
  const recoveryId = Number(sig.yParity ?? 0)
  const packed = new Uint8Array(65)
  packed[0] = recoveryId
  packed.set(rBytes, 1)
  packed.set(sBytes, 33)
  const signatureB64 = encodeBase64(packed)
  return { ...cleared, signature: signatureB64 }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

describe('verifyRelayDescriptorSignature — round-trip', () => {
  it('accepts a descriptor signed by the key whose address matches descriptor.address', async () => {
    const signed = await signDescriptor(baseDescriptor(), TEST_PRIVATE_KEY)
    const result = await verifyRelayDescriptorSignature({ descriptor: signed })
    expect(result.recoveredAddress.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase())
  })

  it('round-trips across representative field variations', async () => {
    const variants: RelayDescriptor[] = [
      baseDescriptor({ activeConnections: 0, tcpBps: 0 }),
      baseDescriptor({
        supportsOverlay: true,
        wireGuardPublicKey: 'abcd',
        wireGuardPort: 51820,
      }),
      baseDescriptor({ apiHttpsAddr: 'https://x?q=<hi&there>' }),
    ]
    for (const v of variants) {
      const signed = await signDescriptor(v, TEST_PRIVATE_KEY)
      await expect(verifyRelayDescriptorSignature({ descriptor: signed })).resolves.toBeDefined()
    }
  })
})

describe('verifyRelayDescriptorSignature — rejection paths', () => {
  it('throws signature-invalid when the signature is empty', async () => {
    await expect(
      verifyRelayDescriptorSignature({ descriptor: baseDescriptor({ signature: '' }) }),
    ).rejects.toBeInstanceOf(RelayVerificationError)
  })

  it('throws signature-invalid when the signature is not valid base64', async () => {
    await expect(
      verifyRelayDescriptorSignature({
        descriptor: baseDescriptor({ signature: '!!!not-base64!!!' }),
      }),
    ).rejects.toBeInstanceOf(RelayVerificationError)
  })

  it('throws signature-invalid when the payload was modified after signing', async () => {
    const signed = await signDescriptor(baseDescriptor(), TEST_PRIVATE_KEY)
    const tampered: RelayDescriptor = { ...signed, activeConnections: signed.activeConnections + 1 }
    await expect(verifyRelayDescriptorSignature({ descriptor: tampered })).rejects.toBeInstanceOf(
      RelayVerificationError,
    )
  })

  it('throws signature-invalid when the advertised address is not the signer', async () => {
    const signed = await signDescriptor(baseDescriptor(), TEST_PRIVATE_KEY)
    const impostor: RelayDescriptor = {
      ...signed,
      address: '0x0000000000000000000000000000000000000000',
    }
    await expect(verifyRelayDescriptorSignature({ descriptor: impostor })).rejects.toMatchObject({
      reason: 'signature-invalid',
    })
  })
})
