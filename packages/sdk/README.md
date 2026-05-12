# @portal-tunnel/x402-sdk

> TypeScript glue between the **x402 payment protocol** and **`gosuda/portal-tunnel`** relay network. Thin wrappers over `@x402/*` upstream, portal-specific trust layer on top.

**Status**: pre-release (`0.1.0-rc.1` on the `next` tag — `npm i @portal-tunnel/x402-sdk@next`)

---

## What this SDK is (and what it is not)

Two external systems, one integration point:

1. **[x402 Foundation's TypeScript packages](https://github.com/x402-foundation/x402)** — the canonical payment protocol. `@x402/core`, `@x402/evm`, `@x402/svm`, `@x402/hono`, `@x402/fetch`, `@x402/extensions`, etc. We depend on them, wrap them with portal-friendly defaults, and never reimplement. When upstream moves, we move.
2. **[`gosuda/portal-tunnel`](https://github.com/gosuda/portal-tunnel)** (Go runtime) — the trustless relay network. We speak its wire protocol (SIWE lease registration, `/discovery`, `/sdk/register`), then add the trust layer (DNSSEC ENS + ERC-8004 identity + ENSIP-25 verification + reputation-based relay selection) that the Go side leaves for consumers to do.

**Our value is the seam**: portal-specific defaults + the trust layer upstream does not provide + a single `createPortalClient()` factory that wires everything together. Not a fork, not a rewrite, not a competing implementation.

---

## Subpaths

| Subpath | Status | Role | Upstream |
|---|---|---|---|
| `/errors` | **LANDED** | viem-style `BaseError` hierarchy with literal `name` discriminator + `walk()` cause chain | — |
| `/facilitator` | **LANDED** | HTTP client over the x402 facilitator contract. AbortSignal + per-attempt timeout + decorrelated-jitter retry + `settle` no-retry safety. | Types from `@x402/core/http` |
| `/auth` | **LANDED** | Portal SIWX (CAIP-122) + portal-tunnel SIWE wire-compat + `createSiwxAuthHeaders()` factory | Wraps `@x402/extensions/sign-in-with-x` (EOA + EIP-1271 + EIP-6492) |
| `/hono` | **LANDED** | Hono middleware with pre-wired portal facilitator + portal trust hooks + unified error mapping | Wraps `@x402/hono` |
| `/client` | **LANDED** | `paidFetch` with portal scheme defaults | Wraps `@x402/fetch` |
| `/erc8004` | **LANDED** | ERC-8004 Identity + Reputation Registry clients + registration file + IPFS pinner hook (portal-specific) | viem + `@wonderland/interop-addresses` + zod |
| `/ensip25` | **LANDED** | ENSIP-25 text key derivation + ERC-7930 encoding + bidirectional cross-check (portal-specific) | `@wonderland/interop-addresses` |
| `/relay` | **LANDED** | `fetchDiscovery` (`GET /discovery` parser, `DiscoveryVersion='7'` + `SDKVersion='6'` pinned to portal-tunnel v2.1.7), `verifyRelayDescriptorSignature` (Layer 0 secp256k1 recoverable), `selectBestRelay` (filter + score by `activeConnections`/`tcpBps`), `verifyPortalHost` (5-layer trust: signature + ENS + ERC-8004 + pluggable `TrustAnchor[]`) | viem + `/erc8004` + `/ensip25` |
| `/cli` (bin) | **LANDED** | `relay-register` — one-shot ERC-8004 agent registration with env-only private key | viem + cac |
| top-level | **LANDED** | `createPortalClient()` — unified factory. `{ facilitator, paidFetch, createHonoMiddleware }` by default; `{ identityRegistry, reputationRegistry, fetchDiscovery, selectBestRelay, verifyPortalHost }` under `identity` when `identity: { chainId, publicClient }` is supplied | composes every subpath |

Every subpath is `sideEffects: false`, dual ESM + CJS, with `.d.ts` + `.d.cts`. A consumer who imports only `/hono` never pays the bundle cost of `/cli` or `/erc8004`.

---

## Install

```bash
# Minimum
pnpm add @portal-tunnel/x402-sdk

# If you use the /hono subpath, install hono as a peer
pnpm add hono
```

`@x402/*` and `viem` are runtime dependencies and arrive transitively — you do not list them in your own `package.json`. Node 20+ required. TypeScript 5.5+ recommended (optional peer).

---

## Quickstart — Hono paywall with portal defaults

```ts
import { ExactEvmScheme } from '@x402/evm'
import { Hono } from 'hono'
import { createPortalFacilitator } from '@portal-tunnel/x402-sdk/facilitator'
import { createPortalHonoMiddleware } from '@portal-tunnel/x402-sdk/hono'

const facilitator = createPortalFacilitator({
  // defaults to the public x402 reference facilitator
  timeoutMs: 10_000,
})

const app = new Hono()

app.use(
  createPortalHonoMiddleware({
    routes: [
      {
        path: '/premium',
        scheme: 'exact',
        network: 'eip155:8453',
        price: '0.01 USD',
        payTo: '0xYourTreasury',
      },
    ],
    schemes: [
      // Bring your own scheme set (consumer chooses which chains to support).
      { network: 'eip155:8453', server: ExactEvmScheme.server },
    ],
    facilitator,
  }),
)

app.get('/premium', (c) => c.json({ article: '...' }))
export default app
```

What's happening under the hood:
- `createPortalFacilitator` adds AbortSignal, per-attempt timeout, decorrelated-jitter retry (2 retries on 429/502/503/504 + network errors), and **`settle` no-retry-by-default** safety (see `/facilitator` docs) — features `@x402/core/http HTTPFacilitatorClient` does not ship.
- `createPortalHonoMiddleware` delegates to upstream `@x402/hono paymentMiddlewareFromConfig`, but pre-wires our `PortalFacilitator` and installs `OnVerifyFailureHook` + `OnSettleFailureHook` that map upstream `FacilitatorResponseError` into our `FacilitatorError` so consumers get one error hierarchy across the whole SDK.

---

## Quickstart — paid fetch on the client

```ts
import { createPortalPaidFetch } from '@portal-tunnel/x402-sdk/client'

const paidFetch = createPortalPaidFetch()                   // ExactEvmScheme on eip155:* by default
const response = await paidFetch('https://api.example.com/premium')
const data = await response.json()
```

Wraps `@x402/fetch wrapFetchWithPaymentFromConfig` with portal-friendly scheme defaults. Auto-retry + loop prevention inherited from upstream.

---

## Quickstart — SIWX authentication header for the facilitator

```ts
import { createPortalFacilitator } from '@portal-tunnel/x402-sdk/facilitator'
import { createPortalSiwx, createSiwxAuthHeaders } from '@portal-tunnel/x402-sdk/auth'

const siwx = createPortalSiwx({
  domain: 'app.example',
  uri: 'https://app.example/portal',
  chainId: 'eip155:8453',
})

const facilitator = createPortalFacilitator({
  createAuthHeaders: createSiwxAuthHeaders({
    siwx,
    walletClient,   // viem WalletClient
    address,
  }),
})
```

Every facilitator request is now auto-signed with a fresh SIWX challenge. The auth is **CAIP-122 compliant** with full EOA + EIP-1271 + EIP-6492 (counterfactual smart wallets) verification support on the server side — inherited from `@x402/extensions/sign-in-with-x`.

---

## Quickstart — portal-tunnel lease registration

```ts
import { createPortalTunnelLeaseFlow } from '@portal-tunnel/x402-sdk/auth'

const flow = createPortalTunnelLeaseFlow({
  relayBaseUrl: 'https://relay.example.com',
})

// 1. Ask the relay for a SIWE challenge.
const challenge = await flow.fetchChallenge({
  identity: { address: walletAddress },
  metadata: { description: 'demo relay' },
  ttl: 3600,
})

// 2. Sign the SIWE message with your viem WalletClient.
const siweSignature = await walletClient.signMessage({
  account: walletAddress,
  message: challenge.siweMessage,
})

// 3. Register the lease and receive the JWT.
const lease = await flow.register({
  challengeId: challenge.challengeId,
  siweMessage: challenge.siweMessage,
  siweSignature,
})

console.log(lease.accessToken)   // ES256K JWT — portal-tunnel `Authorization: Bearer ...`
```

Produces a SIWE message **byte-equal to portal-tunnel's `spruceid/siwe-go` expectation** (statement `"Register a portal lease"`, `chainId: 1`, 2-minute expiry). A TypeScript consumer can register a portal-tunnel lease without ever touching Go.

Errors during this flow surface as `PortalAuthError` with `reason: 'rate-limited' | 'request-failed'`. On 429 you get `err.retryAfterMs` parsed from the relay's `Retry-After` header — handle backoff explicitly without parsing wire details yourself.

---

## Quality bar

Every PR passes 7 gates before merge:

| Gate | What it protects |
|---|---|
| lint (biome) | Style + obvious footguns |
| typecheck (tsc strict + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `noImplicitOverride`) | Type safety |
| test (vitest + msw + prool/anvil) | Collocated unit tests |
| build (tsup) | Dual ESM + CJS + per-entry `.d.ts` + `.d.cts` + sourcemaps |
| publint | `package.json#exports` resolvability |
| attw `--profile node16` | Types resolve under node16 moduleResolution |
| size-limit | Per-subpath budget, total under 200 KB brotli |

---

## License

MIT
