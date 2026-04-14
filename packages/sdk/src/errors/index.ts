export { BaseError, type BaseErrorParameters, type BaseErrorType } from './base'
export {
  IdentityLookupError,
  type IdentityLookupErrorArgs,
  RegistrationError,
  type RegistrationErrorArgs,
  type RegistrationStep,
} from './identity'
export {
  FacilitatorError,
  type FacilitatorErrorArgs,
  PaymentRequiredError,
  type PaymentRequiredErrorArgs,
  type PaymentRequirements,
  VerificationError,
  type VerificationErrorArgs,
} from './payment'
export {
  RelayDiscoveryError,
  type RelayDiscoveryErrorArgs,
  RelayVerificationError,
  type RelayVerificationErrorArgs,
  type RelayVerifyReason,
} from './relay'

/**
 * Discriminator union of every leaf `err.name` value produced by this SDK.
 *
 * `BaseError` is intentionally excluded — it is the root class, not a leaf.
 * Consumers who want to match the root use `err instanceof BaseError`.
 * Consumers who want to exhaustively handle every concrete failure use
 * `switch (err.name)` against this union with `satisfies never` in the
 * default branch.
 *
 * @example
 * type AnyPortalError =
 *   | PaymentRequiredError | FacilitatorError | VerificationError
 *   | RelayDiscoveryError | RelayVerificationError
 *   | IdentityLookupError | RegistrationError
 *
 * function handle(err: AnyPortalError) {
 *   switch (err.name) {
 *     case 'PaymentRequiredError': return 402
 *     case 'FacilitatorError':     return 503
 *     // ...
 *     default: {
 *       const _exhaustive: never = err
 *       return _exhaustive
 *     }
 *   }
 * }
 */
export type PortalErrorName =
  | 'PaymentRequiredError'
  | 'FacilitatorError'
  | 'VerificationError'
  | 'RelayDiscoveryError'
  | 'RelayVerificationError'
  | 'IdentityLookupError'
  | 'RegistrationError'
