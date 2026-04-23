import { describe, expect, it } from 'vitest'
import { RegistrationError } from '../errors'
import {
  buildRegistrationFile,
  parseRegistrationFile,
  RegistrationFileSchema,
} from './registration-file'

const MINIMAL = {
  agentName: 'alice-bot',
  agentDomain: 'alice.eth',
  agentAddress: '0x14791697260E4c9A71f18484C9f997B308e59325',
} as const

describe('buildRegistrationFile', () => {
  it('produces a schemaVersion-1 file from the minimal input', () => {
    const file = buildRegistrationFile(MINIMAL)
    expect(file.schemaVersion).toBe('1')
    expect(file.agentName).toBe(MINIMAL.agentName)
    expect(file.agentDomain).toBe(MINIMAL.agentDomain)
    expect(file.agentAddress).toBe(MINIMAL.agentAddress) // already checksummed
  })

  it('normalizes a lowercase address into EIP-55 checksum', () => {
    const file = buildRegistrationFile({
      ...MINIMAL,
      agentAddress: '0x14791697260e4c9a71f18484c9f997b308e59325',
    })
    expect(file.agentAddress).toBe('0x14791697260E4c9A71f18484C9f997B308e59325')
  })

  it('omits optional fields when not provided', () => {
    const file = buildRegistrationFile(MINIMAL)
    expect(file).not.toHaveProperty('description')
    expect(file).not.toHaveProperty('tags')
    expect(file).not.toHaveProperty('skills')
  })

  it('preserves tags + skills + supportedPaymentSchemes + relayEndpoints when provided', () => {
    const file = buildRegistrationFile({
      ...MINIMAL,
      description: 'a test agent',
      tags: ['demo', 'test'],
      skills: [{ name: 'search', description: 'find things' }],
      supportedPaymentSchemes: ['exact', 'upto'],
      relayEndpoints: ['relay1.portal.example', 'relay2.portal.example'],
    })
    expect(file.description).toBe('a test agent')
    expect(file.tags).toEqual(['demo', 'test'])
    expect(file.skills).toEqual([{ name: 'search', description: 'find things' }])
    expect(file.supportedPaymentSchemes).toEqual(['exact', 'upto'])
    expect(file.relayEndpoints).toEqual(['relay1.portal.example', 'relay2.portal.example'])
  })

  it('rejects a malformed address via RegistrationError step=ipfs', () => {
    expect(() =>
      buildRegistrationFile({
        ...MINIMAL,
        // biome-ignore lint/suspicious/noExplicitAny: exercising invalid input at runtime
        agentAddress: 'not-an-address' as any,
      }),
    ).toThrowError(RegistrationError)
  })

  it('rejects empty agentName / agentDomain', () => {
    expect(() => buildRegistrationFile({ ...MINIMAL, agentName: '' })).toThrowError(
      RegistrationError,
    )
    expect(() => buildRegistrationFile({ ...MINIMAL, agentDomain: '' })).toThrowError(
      RegistrationError,
    )
  })
})

describe('parseRegistrationFile', () => {
  it('accepts a valid JSON object', () => {
    const file = parseRegistrationFile({
      schemaVersion: '1',
      agentName: 'bob',
      agentDomain: 'bob.eth',
      agentAddress: '0x14791697260E4c9A71f18484C9f997B308e59325',
    })
    expect(file.agentName).toBe('bob')
  })

  it('rejects a missing schemaVersion', () => {
    expect(() =>
      parseRegistrationFile({
        agentName: 'bob',
        agentDomain: 'bob.eth',
        agentAddress: '0x14791697260E4c9A71f18484C9f997B308e59325',
      }),
    ).toThrowError(RegistrationError)
  })

  it('rejects a wrong schemaVersion literal', () => {
    expect(() =>
      parseRegistrationFile({
        schemaVersion: '2',
        agentName: 'bob',
        agentDomain: 'bob.eth',
        agentAddress: '0x14791697260E4c9A71f18484C9f997B308e59325',
      }),
    ).toThrowError(RegistrationError)
  })

  it('build → parse round-trip preserves the full record', () => {
    const original = buildRegistrationFile({
      ...MINIMAL,
      description: 'roundtrip',
      tags: ['a', 'b'],
    })
    const serialized = JSON.parse(JSON.stringify(original))
    expect(parseRegistrationFile(serialized)).toEqual(original)
  })
})

describe('RegistrationFileSchema — exported', () => {
  it('is a zod schema with safeParse', () => {
    const result = RegistrationFileSchema.safeParse({
      schemaVersion: '1',
      agentName: 'x',
      agentDomain: 'x.eth',
      agentAddress: '0x14791697260E4c9A71f18484C9f997B308e59325',
    })
    expect(result.success).toBe(true)
  })
})
