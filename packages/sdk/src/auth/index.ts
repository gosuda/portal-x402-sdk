// Re-export upstream types consumers need when plugging in their own signers or verifiers.
export type {
  EVMMessageVerifier,
  EVMSigner,
  SIWxPayload,
} from '@x402/extensions/sign-in-with-x'
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
