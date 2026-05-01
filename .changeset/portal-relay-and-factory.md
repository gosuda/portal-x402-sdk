---
'@portal-tunnel/x402-sdk': minor
---

Add the portal relay + trust layer + top-level factory:

- **`/relay`** — `fetchDiscovery()` parses portal-tunnel's `GET /discovery` response via Zod with `protocol_version` pinned to `DiscoveryVersion = '6'` and all 18 `RelayDescriptor` fields mirrored byte-for-byte from `types/identity.go`. `selectBestRelay()` filters by `discovery` flag + TTL + caller-owned ban list, then ranks by (load, loadScore) with stable sort; a `scoreRelay` hook lets consumers weight by ERC-8004 reputation or geo. `verifyPortalHost()` composes the trust gate — Layer 2 ENS reverse via viem `getEnsName` + Layer 3 ERC-8004 agent wallet match + Layer 4 ENSIP-25 bidirectional cross-check — throwing `RelayVerificationError` with a typed `reason` discriminant on any layer mismatch. Layer 1 TLS remains the runtime's concern (portal-tunnel ENSIP-17 binds hostname ↔ cert).

- **`createPortalClient()`** (top-level, `@portal-tunnel/x402-sdk`) — the unified factory. Minimal default returns `{ facilitator, paidFetch, createHonoMiddleware }`; opt in to identity features by passing `identity: { chainId, publicClient, ensClient? }`, which adds `{ identityRegistry, reputationRegistry, fetchDiscovery, selectBestRelay, verifyPortalHost }` under `client.identity`. Tree-shakeable — consumers paying only for payments never load viem ENS or ERC-8004 code.

- **`relay-register` CLI** (bin) — one-shot ERC-8004 agent registration. `--chain base | mainnet | base-sepolia`, `--agent-uri ipfs://...`, `--private-key-env <NAME>` (env var NAME, not value — flag arguments leak). Maps failures to `RegistrationError.step`.

Sizes (brotli, upstream externalized): `/relay` 2.85 KB, main entry 5.56 KB, `cli/relay-register` 2.59 KB. 195 tests total; all 7 gates green.
