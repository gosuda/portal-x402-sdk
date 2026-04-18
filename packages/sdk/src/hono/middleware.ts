import { FacilitatorResponseError } from '@x402/core/http'
import {
  type FacilitatorClient,
  type PaywallConfig,
  type PaywallProvider,
  type RoutesConfig,
  x402ResourceServer,
} from '@x402/core/server'
import { paymentMiddleware, type SchemeRegistration } from '@x402/hono'
import type { MiddlewareHandler } from 'hono'
import { FacilitatorError } from '../errors'

/** Configuration for {@link createPortalHonoMiddleware}. */
export type CreatePortalHonoMiddlewareConfig = {
  /** Route configurations, passed verbatim to `@x402/hono paymentMiddleware`. */
  routes: RoutesConfig
  /**
   * Facilitator client. A `PortalFacilitator` plugs in directly (AbortSignal +
   * retry + timeout). Any other `FacilitatorClient` implementation works too.
   */
  facilitator: FacilitatorClient
  /**
   * Scheme registrations for server-side verification + settlement.
   * The consumer brings their own schemes (`@x402/evm ExactEvmScheme`,
   * `@x402/svm ExactSvmScheme`, etc.) so the SDK does not assume chain set.
   */
  schemes: SchemeRegistration[]
  /** Paywall UI config, passed through to upstream. */
  paywallConfig?: PaywallConfig
  /** Custom paywall provider, passed through to upstream. */
  paywall?: PaywallProvider
  /** Sync facilitator `/supported` on startup. Default `true`. */
  syncFacilitatorOnStart?: boolean
}

/**
 * Map an upstream facilitator failure (from `OnVerifyFailureHook` or
 * `OnSettleFailureHook` context) into our `FacilitatorError` hierarchy.
 * Returns `null` if the error is not a wire-level facilitator error —
 * caller should let the original error propagate unchanged.
 *
 * Exported for direct unit-testing of the mapping rule without spinning
 * up the full `paymentMiddleware` pipeline.
 */
export function mapFailureToPortalError(error: Error): FacilitatorError | null {
  if (error instanceof FacilitatorError) {
    // Already in our hierarchy (our PortalFacilitator threw it). Pass through.
    return null
  }
  if (error instanceof FacilitatorResponseError) {
    return new FacilitatorError({
      status: 0,
      body: error.message,
      cause: error,
    })
  }
  return null
}

/**
 * Create a Hono middleware that protects routes with x402 payments and
 * plugs in Portal-specific defaults on top of upstream `@x402/hono`.
 *
 * Value-add over calling `@x402/hono paymentMiddleware` directly:
 * - Accepts our `PortalFacilitator` directly (AbortSignal + retry + timeout).
 * - Installs `OnVerifyFailureHook` / `OnSettleFailureHook` that remap upstream
 *   `FacilitatorResponseError` to our `FacilitatorError` so the consumer sees
 *   one error hierarchy across the whole SDK.
 *
 * Spec-level payment handshake, paywall HTML, settlement flow, and scheme
 * dispatch are owned entirely by upstream — we do not reimplement.
 */
export function createPortalHonoMiddleware(
  config: CreatePortalHonoMiddlewareConfig,
): MiddlewareHandler {
  const server = new x402ResourceServer(config.facilitator)
  for (const { network, server: schemeServer } of config.schemes) {
    server.register(network, schemeServer)
  }

  server.onVerifyFailure(async (ctx) => {
    const mapped = mapFailureToPortalError(ctx.error)
    if (mapped !== null) throw mapped
  })
  server.onSettleFailure(async (ctx) => {
    const mapped = mapFailureToPortalError(ctx.error)
    if (mapped !== null) throw mapped
  })

  return paymentMiddleware(
    config.routes,
    server,
    config.paywallConfig,
    config.paywall,
    config.syncFacilitatorOnStart ?? true,
  )
}
