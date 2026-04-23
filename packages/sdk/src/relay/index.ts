export {
  relayDescriptorCanonicalBytes,
  relayDescriptorCanonicalJson,
} from './canonical-bytes'
export {
  type DiscoveryResponse,
  type FetchDiscoveryArgs,
  fetchDiscovery,
  hasOverlayPeer,
  PORTAL_TUNNEL_DISCOVERY_VERSION,
  PORTAL_TUNNEL_SDK_VERSION,
  type RelayDescriptor,
  rfc3339ToUnixNano,
} from './discovery'
export { type SelectBestRelayArgs, selectBestRelay } from './select-best-relay'
export {
  type EnsResolverClient,
  type VerifyPortalHostArgs,
  type VerifyPortalHostResult,
  verifyPortalHost,
} from './verify-portal-host'
export {
  type VerifyRelayDescriptorSignatureArgs,
  type VerifyRelayDescriptorSignatureResult,
  verifyRelayDescriptorSignature,
} from './verify-signature'
