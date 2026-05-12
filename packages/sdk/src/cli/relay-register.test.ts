import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RegistrationError } from '../errors'
import { CHAIN_ALIASES, isCliEntrypoint, readPrivateKeyFromEnv } from './relay-register'

const execFileAsync = promisify(execFile)

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

describe('isCliEntrypoint', () => {
  it('returns false when the module is loaded via import (vitest harness)', () => {
    // Inside vitest, this file is imported by the runner — never invoked as
    // the program entry. Guards against regression of the previous bug where
    // the entrypoint check returned true (or false) in the wrong context.
    expect(isCliEntrypoint()).toBe(false)
  })
})

describe('CLI bin smoke', () => {
  const builtBin = resolve(__dirname, '../../dist/cli/relay-register.mjs')
  const runIfBuilt = existsSync(builtBin) ? it : it.skip

  runIfBuilt(
    'prints --help text when invoked as the program entry (regression: argv[1] symlink case)',
    async () => {
      // Mirrors how npm exposes the CLI: `node dist/cli/relay-register.mjs --help`.
      // Before isCliEntrypoint(), this exited 0 with empty output because the
      // entrypoint check used `endsWith('relay-register.mjs')` which fails on
      // the npm bin symlink path (`node_modules/.bin/relay-register`).
      const { stdout } = await execFileAsync(process.execPath, [builtBin, '--help'])
      expect(stdout).toContain('Usage:')
      expect(stdout).toContain('relay-register')
      expect(stdout).toContain('--chain')
      expect(stdout).toContain('--private-key-env')
      expect(stdout).toContain('--agent-uri')
    },
    20_000,
  )

  runIfBuilt(
    'prints the version number when invoked with --version',
    async () => {
      const { stdout } = await execFileAsync(process.execPath, [builtBin, '--version'])
      // Matches `relay-register/<semver>` (e.g. `relay-register/0.1.0-rc.1`).
      expect(stdout).toMatch(/^relay-register\/\d+\.\d+\.\d+/)
    },
    20_000,
  )
})
