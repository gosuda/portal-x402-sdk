---
'@portal-tunnel/x402-sdk': minor
---

Add the `/facilitator` subpath with `createPortalFacilitator()`, a thin client over the `@x402/core/http` contract that adds AbortSignal support, per-call timeout (default 30 s), and retry with decorrelated jitter for `verify` and `getSupported` (default 2 retries on 429/502/503/504 + network errors, with `Retry-After` honored on 429). `settle()` is single-shot by default for safety against double-charge; opt in per-call via `{ retry: { count: N } }`. Throws `FacilitatorError` with the upstream cause chained. Multi-chain by construction — the wrapper does not whitelist any network, so consumers can target `eip155:*`, `solana:*`, `tron:*`, etc. as soon as a facilitator advertises support. Default URL is the public `x402.org` reference until the Portal-hosted URL is provisioned.
