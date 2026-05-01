---
'@gosuda/portal-x402-sdk': minor
---

Map portal-tunnel HTTP 429 to a typed `PortalAuthError` with `reason: 'rate-limited'` and parsed `retryAfterMs`. portal-tunnel PR #236 (released in v2.1.9+) caps register-challenge issuance at 32 outstanding per source IP; previously the SDK threw a raw `Error` and dropped the `Retry-After` header. Callers can now narrow on `err.reason === 'rate-limited'` and back off using `err.retryAfterMs`. Other non-2xx responses surface as `PortalAuthError` with `reason: 'request-failed'`. New exports from `/auth` and `/errors`: `PortalAuthError`, `PortalAuthReason`, `PortalAuthErrorArgs`, `parseRetryAfterMs`.
