import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RegistrationError } from '../errors'
import { CHAIN_ALIASES, readPrivateKeyFromEnv } from './relay-register'

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

describe('CHAIN_ALIASES', () => {
  it('maps each CLI chain flag to a CAIP-2 id + viem chain + RPC', () => {
    expect(CHAIN_ALIASES.mainnet.chainId).toBe('eip155:1')
    expect(CHAIN_ALIASES.base.chainId).toBe('eip155:8453')
    expect(CHAIN_ALIASES['base-sepolia'].chainId).toBe('eip155:84532')
    for (const alias of Object.values(CHAIN_ALIASES)) {
      expect(alias.defaultRpc.startsWith('http')).toBe(true)
      expect(alias.viemChain.id).toBeGreaterThan(0)
    }
  })
})

describe('readPrivateKeyFromEnv', () => {
  const ENV_NAME = 'RELAY_REGISTER_TEST_KEY'

  beforeEach(() => {
    delete process.env[ENV_NAME]
  })
  afterEach(() => {
    delete process.env[ENV_NAME]
  })

  it('returns a valid hex key from the named env var', () => {
    process.env[ENV_NAME] = TEST_PRIVATE_KEY
    expect(readPrivateKeyFromEnv(ENV_NAME)).toBe(TEST_PRIVATE_KEY)
  })

  it('trims surrounding whitespace', () => {
    process.env[ENV_NAME] = `  ${TEST_PRIVATE_KEY}  `
    expect(readPrivateKeyFromEnv(ENV_NAME)).toBe(TEST_PRIVATE_KEY)
  })

  it('throws RegistrationError when the env var is unset', () => {
    expect(() => readPrivateKeyFromEnv(ENV_NAME)).toThrowError(RegistrationError)
  })

  it('throws RegistrationError when the env var is empty', () => {
    process.env[ENV_NAME] = '   '
    expect(() => readPrivateKeyFromEnv(ENV_NAME)).toThrowError(RegistrationError)
  })

  it('throws RegistrationError when the env var is not 0x-prefixed hex', () => {
    process.env[ENV_NAME] = 'not-hex'
    expect(() => readPrivateKeyFromEnv(ENV_NAME)).toThrowError(RegistrationError)
  })
})
