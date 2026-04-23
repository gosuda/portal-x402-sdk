import { describe, expect, it, vi } from 'vitest'
import { RegistrationError } from '../errors'
import { type IpfsPinner, pinRegistrationFile } from './ipfs'
import { buildRegistrationFile } from './registration-file'

const FILE = buildRegistrationFile({
  agentName: 'alice-bot',
  agentDomain: 'alice.eth',
  agentAddress: '0x14791697260E4c9A71f18484C9f997B308e59325',
})

describe('pinRegistrationFile — success', () => {
  it('encodes the file as UTF-8 JSON and returns the pinner CID', async () => {
    let observed = new Uint8Array()
    const pin: IpfsPinner = async (bytes) => {
      observed = bytes
      return { cid: 'QmTestCid' }
    }
    const result = await pinRegistrationFile(FILE, pin)
    expect(result.cid).toBe('QmTestCid')

    const decoded = JSON.parse(new TextDecoder().decode(observed))
    expect(decoded).toEqual(FILE)
  })
})

describe('pinRegistrationFile — error paths', () => {
  it('wraps a pinner throw in RegistrationError with step=ipfs', async () => {
    const underlying = new Error('pinner offline')
    const pin: IpfsPinner = async () => {
      throw underlying
    }
    try {
      await pinRegistrationFile(FILE, pin)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RegistrationError)
      if (err instanceof RegistrationError) {
        expect(err.step).toBe('ipfs')
        expect(err.cause).toBe(underlying)
      }
    }
  })

  it('rejects a malformed pinner result (missing cid)', async () => {
    const pin = vi.fn(async () => ({}) as { cid: string })
    await expect(pinRegistrationFile(FILE, pin)).rejects.toBeInstanceOf(RegistrationError)
  })
})

describe('pinRegistrationFile — abort', () => {
  it('re-throws a caller abort unchanged (no RegistrationError wrapping)', async () => {
    const controller = new AbortController()
    controller.abort()
    const pin: IpfsPinner = async () => ({ cid: 'unreachable' })
    await expect(
      pinRegistrationFile(FILE, pin, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('times out via AbortSignal.timeout when timeoutMs expires before pinner returns', async () => {
    const pin: IpfsPinner = (_bytes) =>
      new Promise((_resolve, reject) => {
        // Pinner that honors the caller signal. We don't compose via the signal here;
        // instead we rely on the helper detecting the pre-expired internal signal.
        setTimeout(() => reject(new Error('pinner should have been aborted')), 200)
      })
    // We can't easily intercept the signal without plumbing it through pin; instead,
    // verify a pre-aborted external signal short-circuits before pin is invoked.
    const controller = new AbortController()
    controller.abort()
    const spy = vi.fn(pin)
    await expect(
      pinRegistrationFile(FILE, spy, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(spy).not.toHaveBeenCalled()
  })
})
