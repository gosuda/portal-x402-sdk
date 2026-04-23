/**
 * ERC-8004 Agent Registration File — the JSON payload pinned to IPFS and
 * pointed at by `tokenURI` in the Identity Registry.
 *
 * The schema is a Portal convention (not an ERC-8004 spec requirement) — the
 * on-chain contract only knows about the URI, not the file shape. Sticking
 * with one JSON shape across Portal consumers makes cross-relay lookup and
 * verifyPortalHost (PR #5) trivial; consumers who need extra fields can use
 * ERC-8004 `setMetadata(key, value)` writes instead of stuffing arbitrary
 * data into the registration file.
 */

import type { Address } from 'viem'
import { getAddress } from 'viem'
import { z } from 'zod'
import { RegistrationError } from '../errors/identity'

/** Literal-typed `0x${string}` address check + EIP-55 normalization. */
const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((raw) => getAddress(raw))

const SkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
})

/** zod schema for the Portal agent registration file. Version 1. */
export const RegistrationFileSchema = z.object({
  schemaVersion: z.literal('1'),
  agentName: z.string().min(1),
  agentDomain: z.string().min(1),
  agentAddress: AddressSchema,
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  skills: z.array(SkillSchema).optional(),
  supportedPaymentSchemes: z.array(z.string().min(1)).optional(),
  relayEndpoints: z.array(z.string().min(1)).optional(),
})

export type RegistrationFile = z.infer<typeof RegistrationFileSchema>

/** Input to {@link buildRegistrationFile}. Optional fields are omitted from the output when undefined. */
export type RegistrationFileInput = {
  agentName: string
  agentDomain: string
  agentAddress: Address
  description?: string
  tags?: readonly string[]
  skills?: ReadonlyArray<{ name: string; description: string }>
  supportedPaymentSchemes?: readonly string[]
  relayEndpoints?: readonly string[]
}

/**
 * Build a canonical registration file from an input bag. Throws
 * {@link RegistrationError} with `step: 'ipfs'` if the shape fails validation
 * (ipfs is the downstream step that would fail on a malformed file).
 */
export function buildRegistrationFile(input: RegistrationFileInput): RegistrationFile {
  const candidate: Record<string, unknown> = {
    schemaVersion: '1',
    agentName: input.agentName,
    agentDomain: input.agentDomain,
    agentAddress: input.agentAddress,
  }
  if (input.description !== undefined) candidate.description = input.description
  if (input.tags !== undefined) candidate.tags = [...input.tags]
  if (input.skills !== undefined) candidate.skills = input.skills.map((s) => ({ ...s }))
  if (input.supportedPaymentSchemes !== undefined) {
    candidate.supportedPaymentSchemes = [...input.supportedPaymentSchemes]
  }
  if (input.relayEndpoints !== undefined) {
    candidate.relayEndpoints = [...input.relayEndpoints]
  }
  const result = RegistrationFileSchema.safeParse(candidate)
  if (!result.success) {
    throw new RegistrationError({ step: 'ipfs', cause: new Error(result.error.message) })
  }
  return result.data
}

/**
 * Parse an untrusted input (typically the JSON fetched from IPFS) into a
 * validated `RegistrationFile`. Throws {@link RegistrationError} with
 * `step: 'ipfs'` if validation fails.
 */
export function parseRegistrationFile(raw: unknown): RegistrationFile {
  const result = RegistrationFileSchema.safeParse(raw)
  if (!result.success) {
    throw new RegistrationError({ step: 'ipfs', cause: new Error(result.error.message) })
  }
  return result.data
}
