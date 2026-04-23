export {
  type DiscoveryResponse,
  type FetchDiscoveryArgs,
  fetchDiscovery,
  PORTAL_TUNNEL_DISCOVERY_VERSION,
  type RelayDescriptor,
  type RelayIdentity,
} from './discovery'
export { type SelectBestRelayArgs, selectBestRelay } from './select-best-relay'
export {
  type EnsResolverClient,
  type VerifyPortalHostArgs,
  type VerifyPortalHostResult,
  verifyPortalHost,
} from './verify-portal-host'
