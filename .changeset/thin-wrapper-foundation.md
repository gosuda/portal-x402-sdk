---
'@portal-tunnel/x402-sdk': minor
---

Add three thin-wrapper subpaths over the 2026-04-13 upstream release of `@x402/*`:

- **`/auth`** — `createPortalSiwx()` wraps `@x402/extensions/sign-in-with-x` (CAIP-122 with EOA + EIP-1271 + EIP-6492) with portal defaults (`eip155:8453`, 10-minute expiry, SIWE-ABNF nonces via `viem/siwe`). `buildPortalTunnelChallengeMessage()` + `createPortalTunnelLeaseFlow()` produce a byte-equal SIWE message against `gosuda/portal-tunnel`'s `portal/auth/auth.go` lease-registration wire format (statement `"Register a portal lease"`, `chainId: 1`, 2-min expiry, RFC3339 timestamps) and drive the full `/sdk/register/challenge` → sign → `/sdk/register` flow. `createSiwxAuthHeaders()` drops into `createPortalFacilitator({ createAuthHeaders })` and attaches a fresh SIWX challenge (default `SIGN-IN-WITH-X` canonical header, opt-in `Authorization: Bearer` scheme) to each facilitator request.
- **`/hono`** — `createPortalHonoMiddleware()` wraps `@x402/hono paymentMiddleware` + `x402ResourceServer`. Accepts our `PortalFacilitator` directly, pre-installs `OnVerifyFailureHook` / `OnSettleFailureHook` that remap upstream `FacilitatorResponseError` to our `FacilitatorError`, and reserves a `BeforeVerifyHook` slot (`trust.verifyHost`) for the portal host verification gate that lands in the identity fast-follow PR.
- **`/client`** — `createPortalPaidFetch()` wraps `@x402/fetch wrapFetchWithPayment`. Accepts either a viem-compatible `ClientEvmSigner` (one-line shortcut: auto-registers `ExactEvmScheme` on `eip155:*` for both v2 and v1 via upstream's `registerExactEvmScheme`) or explicit `SchemeRegistration[]` for non-EVM setups. Supports upstream policies, custom `paymentRequirementsSelector`, and fetch injection.

Wire-level payment handshake, `PAYMENT-SIGNATURE` encoding, paywall HTML, scheme dispatch, and loop prevention are owned entirely by upstream — this SDK adds Portal-specific defaults, one unified error hierarchy via `FacilitatorError`, and the `portal-tunnel` SIWE wire bridge that TypeScript consumers cannot get anywhere else. Measured sizes (brotli, with `@x402/*` + `viem` externalized): `/auth` 1.47 KB, `/hono` 874 B, `/client` 452 B.
