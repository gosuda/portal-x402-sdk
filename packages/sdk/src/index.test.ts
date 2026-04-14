import { describe, expect, it } from 'vitest'
import { VERSION } from './index'

describe('portal-x402-sdk', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('0.0.0')
  })
})
