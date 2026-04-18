// Re-export upstream types consumers need when configuring routes and schemes.
export type {
  FacilitatorClient,
  PaywallConfig,
  PaywallProvider,
  RoutesConfig,
} from '@x402/core/server'
export type { SchemeRegistration } from '@x402/hono'
export {
  type CreatePortalHonoMiddlewareConfig,
  createPortalHonoMiddleware,
  mapFailureToPortalError,
  type PortalTrustOptions,
} from './middleware'
