/**
 * Layer 0 of the portal trust gate — verify that a {@link RelayDescriptor}
 * is signed by the secp256k1 private key whose EIP-55 address equals
 * `descriptor.address`.
 *
 * Mirrors `portal/auth/relay_descriptor.go` `VerifyRelayDescriptor` from
 * `gosuda/portal-tunnel@v2.1.7`:
 *
 *   1. base64-StdEncoding-decode `signature` → 65 bytes `[v(1) | r(32) | s(32)]`
 *      (dcrd recoverable layout, recovery id at the front).
 *   2. Clear the `signature` field and compute `CanonicalBytes(descriptor)`.
 *   3. SHA-256 the canonical bytes (plain SHA-256 — not keccak, no EIP-191).
 *   4. secp256k1-recover the public key from (hash, r, s, v).
 *   5. Derive the Ethereum address via `keccak256(uncompressed[1:])[-20:]`
 *      and re-checksum with EIP-55 (Go calls this `NormalizeEVMAddress`).
 *   6. Case-insensitive compare to `descriptor.address`.
 *
 * Any step failing throws `RelayVerificationError` with
 * `reason: 'signature-invalid'`.
 */

import { type Address, bytesToHex, type Hex } from 'viem'
import { publicKeyToAddress, recoverPublicKey, sha256 as viemSha256 } from 'viem/utils'
import { RelayVerificationError } from '../errors/relay'
import { relayDescriptorCanonicalBytes } from './canonical-bytes'
import type { RelayDescriptor } from './discovery'

/** Options for {@link verifyRelayDescriptorSignature}. */
export type VerifyRelayDescriptorSignatureArgs = {
  descriptor: RelayDescriptor
  /** Host label for error messages (typically the descriptor's apiHttpsAddr or configured host). */
  host?: string
}

/** Result of a passing signature verification. */
export type VerifyRelayDescriptorSignatureResult = {
  recoveredAddress: Address
}

/**
 * Verify the signed relay descriptor. Returns the recovered address on
 * success; throws `RelayVerificationError` with `reason: 'signature-invalid'`
 * on any failure (empty signature, base64 decode error, wrong length,
 * recovery failure, address mismatch).
 *
 * @example
 * ```ts
 * const { relays } = await fetchDiscovery({ relayBaseUrl })
 * for (const relay of relays) {
 *   await verifyRelayDescriptorSignature({ descriptor: relay })
 * }
 * ```
 */
export async function verifyRelayDescriptorSignature(
  args: VerifyRelayDescriptorSignatureArgs,
): Promise<VerifyRelayDescriptorSignatureResult> {
  const host = args.host ?? args.descriptor.apiHttpsAddr
  const signatureB64 = args.descriptor.signature.trim()
  if (signatureB64 === '') {
    throw new RelayVerificationError({
      host,
      reason: 'signature-invalid',
      metaMessages: ['descriptor is unsigned'],
    })
  }

  let sigBytes: Uint8Array
  try {
    sigBytes = base64StdDecode(signatureB64)
  } catch (err) {
    throw new RelayVerificationError({
      host,
      reason: 'signature-invalid',
      ...(err instanceof Error && { cause: err }),
      metaMessages: ['signature is not valid base64'],
    })
  }

  if (sigBytes.length !== 65) {
    throw new RelayVerificationError({
      host,
      reason: 'signature-invalid',
      metaMessages: [`expected 65-byte signature, got ${sigBytes.length}`],
    })
  }

  // dcrd recoverable layout: [v(1) | r(32) | s(32)]. viem/noble expect
  // the opposite layout [r(32) | s(32) | v(1)] when passing a compact
  // 65-byte hex. Rotate here.
  const v = sigBytes[0] ?? 0
  const r = sigBytes.slice(1, 33)
  const s = sigBytes.slice(33, 65)
  const signatureHex: Hex = `0x${bytesToHex(r, { size: 32 }).slice(2)}${bytesToHex(s, { size: 32 }).slice(2)}${v.toString(16).padStart(2, '0')}`

  // Compute the SHA-256 hash of the canonical bytes. Go's `crypto/sha256`
  // is byte-identical to viem's `sha256` (both use SHA-256 per FIPS 180-4).
  const canonicalBytes = relayDescriptorCanonicalBytes(args.descriptor)
  const digest: Hex = viemSha256(bytesToHex(canonicalBytes) as Hex)

  let pubKey: Hex
  try {
    pubKey = await recoverPublicKey({ hash: digest, signature: signatureHex })
  } catch (err) {
    throw new RelayVerificationError({
      host,
      reason: 'signature-invalid',
      ...(err instanceof Error && { cause: err }),
      metaMessages: ['secp256k1 public key recovery failed'],
    })
  }

  // `publicKeyToAddress` derives `keccak256(uncompressed[1:])[-20:]` and
  // returns an EIP-55 checksummed address — byte-identical to Go's
  // `NormalizeEVMAddress` output.
  const recovered = publicKeyToAddress(pubKey)

  if (recovered.toLowerCase() !== args.descriptor.address.toLowerCase()) {
    throw new RelayVerificationError({
      host,
      reason: 'signature-invalid',
      metaMessages: [
        `recovered address ${recovered} does not match descriptor address ${args.descriptor.address}`,
      ],
    })
  }

  return { recoveredAddress: recovered }
}

/**
 * Node / browser-portable base64 StdEncoding decoder. Matches Go's
 * `base64.StdEncoding` — standard alphabet, mandatory `=` padding,
 * strict about trailing chars.
 */
function base64StdDecode(input: string): Uint8Array {
  // Use globalThis.atob when available (browsers, Node 16+), fall back
  // to Buffer for older runtimes.
  if (typeof atob === 'function') {
    const binary = atob(input)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  // Node without atob shim (unlikely on supported versions) — fallback.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Buffer } = require('node:buffer') as typeof import('node:buffer')
  return new Uint8Array(Buffer.from(input, 'base64'))
}
