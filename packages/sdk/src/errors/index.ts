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

/** Discriminator union of every leaf `err.name` value produced by this SDK (excludes `BaseError`). */
export type PortalErrorName =
  | 'PaymentRequiredError'
  | 'FacilitatorError'
  | 'VerificationError'
  | 'RelayDiscoveryError'
  | 'RelayVerificationError'
  | 'IdentityLookupError'
  | 'RegistrationError'
