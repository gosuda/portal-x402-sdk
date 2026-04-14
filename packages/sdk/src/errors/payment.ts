import type { PaymentRequirements } from '@x402/core/schemas'
import { BaseError, type BaseErrorParameters } from './base'

export type { PaymentRequirements }

/** Options for {@link PaymentRequiredError}. */
export type PaymentRequiredErrorArgs = {
  /** Full x402 `PaymentRequirements` object the server expects. */
  requirements: PaymentRequirements
  cause?: BaseErrorParameters['cause']
  metaMessages?: BaseErrorParameters['metaMessages']
}

/**
 * Thrown when a request reaches a protected handler without a valid
 * `X-PAYMENT` header. Rendered as HTTP 402 by the Hono middleware.
 *
 * @example
 * throw new PaymentRequiredError({ requirements })
 */
export class PaymentRequiredError extends BaseError {
  override readonly name = 'PaymentRequiredError' as const
  readonly requirements: PaymentRequirements

  constructor(args: PaymentRequiredErrorArgs) {
    const amount =
      'maxAmountRequired' in args.requirements
        ? args.requirements.maxAmountRequired
        : args.requirements.amount
    super(
      `Payment required: ${amount} ${args.requirements.asset} via ${args.requirements.scheme}`,
      { cause: args.cause, metaMessages: args.metaMessages },
    )
    this.requirements = args.requirements
  }
}

/** Options for {@link FacilitatorError}. */
export type FacilitatorErrorArgs = {
  /** HTTP status returned by the facilitator (e.g. 500, 502, 503). */
  status: number
  /** Raw response body — string or parsed JSON. */
  body: unknown
  cause?: BaseErrorParameters['cause']
  metaMessages?: BaseErrorParameters['metaMessages']
}

/**
 * Thrown when the x402 facilitator HTTP API returns a non-2xx response
 * or an unexpected payload. Rendered as HTTP 503 by the Hono middleware.
 *
 * @example
 * throw new FacilitatorError({ status: 503, body: 'upstream down' })
 */
export class FacilitatorError extends BaseError {
  override readonly name = 'FacilitatorError' as const
  readonly status: number
  readonly body: unknown

  constructor(args: FacilitatorErrorArgs) {
    super(`Facilitator returned ${args.status}`, {
      cause: args.cause,
      metaMessages: args.metaMessages,
      details: typeof args.body === 'string' ? args.body : JSON.stringify(args.body),
    })
    this.status = args.status
    this.body = args.body
  }
}

/** Options for {@link VerificationError}. */
export type VerificationErrorArgs = {
  /** Human-friendly rejection reason (e.g. 'invalid_signature'). */
  reason: string
  /** Wire-level invalidReason code from `@x402/core`, if available. */
  invalidReason?: string
  cause?: BaseErrorParameters['cause']
  metaMessages?: BaseErrorParameters['metaMessages']
}

/**
 * Thrown when the facilitator rejects a `verify` or `settle` call with an
 * `invalidReason` code, or when a signed payload fails local validation.
 *
 * @example
 * throw new VerificationError({ reason: 'invalid_signature' })
 */
export class VerificationError extends BaseError {
  override readonly name = 'VerificationError' as const
  readonly reason: string
  readonly invalidReason?: string

  constructor(args: VerificationErrorArgs) {
    super(`Payment verification failed: ${args.reason}`, {
      cause: args.cause,
      metaMessages: args.metaMessages,
    })
    this.reason = args.reason
    if (args.invalidReason !== undefined) this.invalidReason = args.invalidReason
  }
}
