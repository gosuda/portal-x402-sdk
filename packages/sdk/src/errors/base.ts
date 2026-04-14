/**
 * Optional parameters for {@link BaseError} and its subclasses.
 *
 * @example
 * new BaseError('Short message', {
 *   cause: upstreamError,
 *   details: 'raw payload',
 *   metaMessages: ['context line'],
 * })
 */
export type BaseErrorParameters = {
  cause?: BaseError | Error | undefined
  details?: string | undefined
  docsBaseUrl?: string | undefined
  docsPath?: string | undefined
  docsSlug?: string | undefined
  metaMessages?: string[] | undefined
}

/**
 * Discriminator alias narrowing `err.name` to the literal `'BaseError'`.
 * Used alongside per-subclass literals to build exhaustive switches.
 */
export type BaseErrorType = BaseError & { name: 'BaseError' }

/**
 * Root of the `@gosuda/portal-x402-sdk` error hierarchy.
 *
 * Every concrete error subclass extends this and sets `name` to a unique
 * literal. Consumers exhaustively handle failures by switching on `err.name`
 * against the `PortalErrorName` discriminator union exported from
 * `@gosuda/portal-x402-sdk/errors`.
 *
 * Immutable after construction. Native `Error.cause` chain. No global
 * mutable config, no `Symbol.for()` brand.
 *
 * @example
 * try {
 *   throw new BaseError('Something went wrong', { cause: upstream })
 * } catch (err) {
 *   if (err instanceof BaseError) {
 *     console.log(err.shortMessage, err.walk().message)
 *   }
 * }
 */
export class BaseError extends Error {
  override readonly name: string = 'BaseError'
  readonly shortMessage: string
  readonly details: string
  readonly docsPath?: string
  readonly metaMessages?: string[]

  constructor(shortMessage: string, args: BaseErrorParameters = {}) {
    const details = args.details ?? (args.cause instanceof Error ? args.cause.message : '')

    const docsUrl =
      args.docsBaseUrl !== undefined && args.docsPath !== undefined
        ? `${args.docsBaseUrl}${args.docsPath}${args.docsSlug !== undefined ? `#${args.docsSlug}` : ''}`
        : undefined

    const parts: string[] = [shortMessage || 'An error occurred.']
    if (args.metaMessages !== undefined && args.metaMessages.length > 0) {
      parts.push('', ...args.metaMessages)
    }
    if (docsUrl !== undefined || details !== '') {
      parts.push('')
      if (docsUrl !== undefined) parts.push(`Docs: ${docsUrl}`)
      if (details !== '') parts.push(`Details: ${details}`)
    }

    super(parts.join('\n'), args.cause !== undefined ? { cause: args.cause } : undefined)

    this.shortMessage = shortMessage
    this.details = details
    if (args.docsPath !== undefined) this.docsPath = args.docsPath
    if (args.metaMessages !== undefined) this.metaMessages = args.metaMessages
  }

  /**
   * Traverse the native `Error.cause` chain.
   *
   * Without a predicate, returns the deepest `Error` in the chain (or `this`
   * if there is none). With a predicate, returns the first value for which
   * the predicate returns `true`, or `null` if no match is found.
   */
  walk(): Error
  walk(fn: (err: unknown) => boolean): Error | null
  walk(fn?: (err: unknown) => boolean): Error | null {
    let current: unknown = this
    let lastError: Error = this
    while (true) {
      if (current instanceof Error) lastError = current
      if (fn !== undefined && fn(current) === true) {
        return current instanceof Error ? current : null
      }
      if (
        typeof current === 'object' &&
        current !== null &&
        'cause' in current &&
        current.cause !== undefined
      ) {
        current = current.cause
        continue
      }
      return fn !== undefined ? null : lastError
    }
  }
}
