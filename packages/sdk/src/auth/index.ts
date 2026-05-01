// Re-export upstream types consumers need when plugging in their own signers or verifiers.
export type {
  EVMMessageVerifier,
  EVMSigner,
  SIWxPayload,
} from '@x402/extensions/sign-in-with-x'
// Re-export the typed error thrown by `createPortalTunnelLeaseFlow` for ergonomic narrowing.
export {
  PortalAuthError,
  type PortalAuthErrorArgs,
  type PortalAuthReason,
} from '../errors/auth'
export {
  type CreateSiwxAuthHeadersConfig,
  createSiwxAuthHeaders,
  type SiwxAuthHeaderPaths,
  type SiwxAuthHeaderScheme,
} from './auth-headers'
export {
  createPortalSiwx,
  type PortalSiwxAuth,
  type PortalSiwxConfig,
  type PortalSiwxMessage,
  type PortalSiwxSignOptions,
  type PortalSiwxVerifyOptions,
} from './portal-siwx'
export {
  buildPortalTunnelChallengeMessage,
  createPortalTunnelLeaseFlow,
  type PortalTunnelChallenge,
  type PortalTunnelChallengeInput,
  type PortalTunnelChallengeRequest,
  type PortalTunnelLease,
  type PortalTunnelLeaseConfig,
  type PortalTunnelLeaseFlow,
  type PortalTunnelLeaseMetadata,
} from './portal-tunnel-siwe'
