/**
 * `@portal-tunnel/x402-sdk` main entry. Re-exports the unified
 * `createPortalClient()` factory and the types consumers need to configure
 * it. Subpath exports (`/auth`, `/client`, `/erc8004`, `/ensip25`,
 * `/errors`, `/facilitator`, `/hono`, `/relay`) stay the place for
 * narrow-focus integrations.
 */

export const VERSION = '0.1.0-rc.0'

export {
  type CreatePortalClientConfig,
  createPortalClient,
  type PortalClient,
  type PortalIdentityConfig,
  type PortalIdentityHandles,
  type PortalPaymentConfig,
  type PortalPaymentHandles,
} from './create-portal-client'
