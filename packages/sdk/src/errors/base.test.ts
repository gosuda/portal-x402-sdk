import { describe, expect, it } from 'vitest'
import { BaseError } from './base'

describe('BaseError', () => {
  it('stores shortMessage and name with no args', () => {
    const err = new BaseError('something went wrong')
    expect(err.shortMessage).toBe('something went wrong')
    expect(err.name).toBe('BaseError')
    expect(err.message).toBe('something went wrong')
    expect(err.details).toBe('')
    expect(err.docsPath).toBeUndefined()
    expect(err.metaMessages).toBeUndefined()
    expect(err.cause).toBeUndefined()
  })

  it('joins metaMessages into the composed message', () => {
    const err = new BaseError('short', {
      metaMessages: ['context 1', 'context 2'],
    })
    expect(err.message).toBe('short\n\ncontext 1\ncontext 2')
    expect(err.metaMessages).toEqual(['context 1', 'context 2'])
  })

  it('appends Details line when details provided', () => {
    const err = new BaseError('short', { details: 'raw wire payload' })
    expect(err.message).toBe('short\n\nDetails: raw wire payload')
    expect(err.details).toBe('raw wire payload')
  })

  it('composes Docs line from docsBaseUrl + docsPath + docsSlug', () => {
    const err = new BaseError('short', {
      docsBaseUrl: 'https://docs.example',
      docsPath: '/errors',
      docsSlug: 'base-error',
    })
    expect(err.message).toContain('Docs: https://docs.example/errors#base-error')
    expect(err.docsPath).toBe('/errors')
  })

  it('chains Error.cause natively and derives details from cause.message', () => {
    const inner = new Error('inner failure')
    const err = new BaseError('outer short', { cause: inner })
    expect(err.cause).toBe(inner)
    expect(err.details).toBe('inner failure')
    expect(err.message).toContain('Details: inner failure')
  })

  it('walk() without args returns the deepest Error in the chain', () => {
    const leaf = new Error('leaf')
    const mid = new BaseError('mid', { cause: leaf })
    const top = new BaseError('top', { cause: mid })
    expect(top.walk()).toBe(leaf)

    const standalone = new BaseError('solo')
    expect(standalone.walk()).toBe(standalone)
  })

  it('walk() with predicate returns the first matching Error or null', () => {
    const leaf = new Error('leaf')
    const mid = new BaseError('mid short', { cause: leaf })
    const top = new BaseError('top', { cause: mid })

    const match = top.walk((e) => e instanceof BaseError && e.shortMessage === 'mid short')
    expect(match).toBe(mid)

    const nomatch = top.walk((e) => e instanceof Error && e.message === 'nope')
    expect(nomatch).toBeNull()
  })

  it('supports literal name discriminator narrowing in subclasses', () => {
    class SubError extends BaseError {
      override readonly name = 'SubError' as const
    }
    const err: BaseError = new SubError('sub')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(SubError)
    expect(err.name).toBe('SubError')

    if (err.name === 'SubError') {
      const narrowed: 'SubError' = err.name
      expect(narrowed).toBe('SubError')
    }
  })
})
