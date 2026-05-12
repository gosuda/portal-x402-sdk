# @portal-tunnel/x402-sdk

## 0.1.0-rc.1

### Patch Changes

- [#11](https://github.com/gosuda/portal-x402-sdk/pull/11) [`6d8d914`](https://github.com/gosuda/portal-x402-sdk/commit/6d8d9140b4e62f0e6b6f667208315a201d881c15) Thanks [@GrapeInTheTree](https://github.com/GrapeInTheTree)! - Fix CLI entrypoint detection so `relay-register` works after `npm install`, and add real-chain + anvil-fork integration tests against Base mainnet.

  **Bug fix (CLI)**: the previous entrypoint check used `process.argv[1]?.endsWith('relay-register.mjs')`, which is `false` when the bin is invoked via the npm `.bin/relay-register` symlink (no `.mjs` suffix on `argv[1]`). The CLI ran in dev (`node dist/cli/relay-register.mjs`) but silently exited with code 0 and no output after `npm install`. Replaced with `isCliEntrypoint()` which compares the realpath of `import.meta.url` against the realpath of `process.argv[1]` — the canonical ESM "am I the entry point" check, robust to symlinks.

  **New tests** (+10 total, 231 → 241):

  - `cli/relay-register.test.ts` — `isCliEntrypoint()` regression test + 2 bin smoke tests that `execFile` the built `.mjs` and assert `--help` / `--version` output (covers the symlink invocation path the old check missed)
  - `erc8004/identity-registry.real-chain.test.ts` — 5 read-only assertions against live Base mainnet via the public RPC: contract deployed at the canonical Identity Registry address, client binds correctly by chainId, non-existent agent surfaces as `IdentityLookupError`, Reputation Registry also deployed. Skips cleanly on RPC unreachable
  - `erc8004/identity-registry.anvil.test.ts` — end-to-end write test: spawns anvil forking Base mainnet, funds the test wallet via `anvil_setBalance`, clears any pre-deployed code at the dev key address via `anvil_setCode` (anvil's deterministic dev keys are public, so people have deployed contracts at those addresses on real mainnets — this matters because the contract's `onERC721Received` callback would otherwise transfer the freshly-minted NFT away and revert `register()`), resets the nonce, then calls `register(agentURI)` and verifies the `Registered` event parse + `tokenURI` round-trip + `getOwner` matches. Skips cleanly when anvil is not installed

  **Misc**:

  - `.size-limit.json` ignores `fs` + `url` for the CLI bundle (esbuild strips the `node:` prefix, which is fine at runtime but confuses size-limit's bundler)

## 0.1.0-rc.0

### Minor Changes

- [#8](https://github.com/gosuda/portal-x402-sdk/pull/8) [`d8ef17f`](https://github.com/gosuda/portal-x402-sdk/commit/d8ef17ffc18463809ae881613bdb8334c70e6d40) Thanks [@GrapeInTheTree](https://github.com/GrapeInTheTree)! - Map portal-tunnel HTTP 429 to a typed `PortalAuthError` with `reason: 'rate-limited'` and parsed `retryAfterMs`. portal-tunnel PR [#236](https://github.com/gosuda/portal-x402-sdk/issues/236) (released in v2.1.9+) caps register-challenge issuance at 32 outstanding per source IP; previously the SDK threw a raw `Error` and dropped the `Retry-After` header. Callers can now narrow on `err.reason === 'rate-limited'` and back off using `err.retryAfterMs`. Other non-2xx responses surface as `PortalAuthError` with `reason: 'request-failed'`. New exports from `/auth` and `/errors`: `PortalAuthError`, `PortalAuthReason`, `PortalAuthErrorArgs`, `parseRetryAfterMs`.

- [#1](https://github.com/gosuda/portal-x402-sdk/pull/1) [`417749b`](https://github.com/gosuda/portal-x402-sdk/commit/417749bfbecf824478ac56a66fb3df46fe2529a7) Thanks [@GrapeInTheTree](https://github.com/GrapeInTheTree)! - Add the `/errors` subpath with a viem-style `BaseError` hierarchy and seven concrete leaf classes: `PaymentRequiredError`, `FacilitatorError`, `VerificationError`, `RelayDiscoveryError`, `RelayVerificationError`, `IdentityLookupError`, `RegistrationError`. Each subclass is an immutable `readonly` class with a single options-object constructor, a literal `name` discriminator (`override readonly name = 'XxxError' as const`), and native `Error.cause` chaining with a `walk()` traversal helper on the base. Exports a `PortalErrorName` discriminator union for exhaustive `switch` handling.

- [#2](https://github.com/gosuda/portal-x402-sdk/pull/2) [`b7dbe53`](https://github.com/gosuda/portal-x402-sdk/commit/b7dbe538cfe44b6c1eb01642b09dcdde006dc66c) Thanks [@GrapeInTheTree](https://github.com/GrapeInTheTree)! - Add the `/facilitator` subpath with `createPortalFacilitator()`, a thin client over the `@x402/core/http` contract that adds AbortSignal support, per-call timeout (default 30 s), and retry with decorrelated jitter for `verify` and `getSupported` (default 2 retries on 429/502/503/504 + network errors, with `Retry-After` honored on 429). `settle()` is single-shot by default for safety against double-charge; opt in per-call via `{ retry: { count: N } }`. Throws `FacilitatorError` with the upstream cause chained. Multi-chain by construction — the wrapper does not whitelist any network, so consumers can target `eip155:*`, `solana:*`, `tron:*`, etc. as soon as a facilitator advertises support. Default URL is the public `x402.org` reference until the Portal-hosted URL is provisioned.

- [#4](https://github.com/gosuda/portal-x402-sdk/pull/4) [`d51315c`](https://github.com/gosuda/portal-x402-sdk/commit/d51315c3840cc160504d8779cc9b6f8e8937aef7) Thanks [@GrapeInTheTree](https://github.com/GrapeInTheTree)! - Add portal-identity primitives:

  - **`/ensip25`** — `deriveEnsip25Key({ chainId, registryAddress, agentId })` produces the canonical `agent-registration[<erc7930-hex>][<agentId>]` text record key via `@wonderland/interop-addresses`. `crossCheckEnsip25()` verifies an ENS-name ↔ ERC-8004 agent-id binding using viem's `getEnsText` + the Identity Registry client, throwing `RelayVerificationError` with `reason='ensip25-mismatch'` on any mismatch.
  - **`/erc8004`** — `ERC8004_ADDRESSES` frozen literal-union map (Ethereum + Base mainnet share the same CREATE2 vanity; Base Sepolia testnet vanity separately). `createIdentityRegistryClient()` wraps the ERC-721-based registry (register overloads, tokenURI/getAgentWallet/ownerOf reads, setAgentURI/setMetadata writes). `createReputationRegistryClient()` wraps the feedback-based reputation registry (giveFeedback/revokeFeedback writes, readFeedback/getSummary reads). `buildRegistrationFile()` + `parseRegistrationFile()` produce and validate the Portal registration file JSON. `pinRegistrationFile(file, pinner)` helper accepts any consumer-provided `IpfsPinner = (bytes) => Promise<{ cid }>`, keeping SDK zero-vendor-coupling.

  Also: extracts retry/abort HTTP helper from `/facilitator` into internal `src/internal/http.ts` for reuse; drops the obsolete `/schemes` subpath stub per ADR 001.

  Sizes (brotli, with `@x402/*` + `viem` + `@wonderland/interop-addresses` + `zod` externalized): `/ensip25` 1 KB, `/erc8004` 2.81 KB. 158 tests total across the package.

- [#5](https://github.com/gosuda/portal-x402-sdk/pull/5) [`f5bc7e5`](https://github.com/gosuda/portal-x402-sdk/commit/f5bc7e538a6b890e00cacd1a2eee57cbbd80741f) Thanks [@GrapeInTheTree](https://github.com/GrapeInTheTree)! - Add the portal relay + trust layer + top-level factory:

  - **`/relay`** — `fetchDiscovery()` parses portal-tunnel's `GET /discovery` response via Zod with `protocol_version` pinned to `DiscoveryVersion = '6'` and all 18 `RelayDescriptor` fields mirrored byte-for-byte from `types/identity.go`. `selectBestRelay()` filters by `discovery` flag + TTL + caller-owned ban list, then ranks by (load, loadScore) with stable sort; a `scoreRelay` hook lets consumers weight by ERC-8004 reputation or geo. `verifyPortalHost()` composes the trust gate — Layer 2 ENS reverse via viem `getEnsName` + Layer 3 ERC-8004 agent wallet match + Layer 4 ENSIP-25 bidirectional cross-check — throwing `RelayVerificationError` with a typed `reason` discriminant on any layer mismatch. Layer 1 TLS remains the runtime's concern (portal-tunnel ENSIP-17 binds hostname ↔ cert).

  - **`createPortalClient()`** (top-level, `@portal-tunnel/x402-sdk`) — the unified factory. Minimal default returns `{ facilitator, paidFetch, createHonoMiddleware }`; opt in to identity features by passing `identity: { chainId, publicClient, ensClient? }`, which adds `{ identityRegistry, reputationRegistry, fetchDiscovery, selectBestRelay, verifyPortalHost }` under `client.identity`. Tree-shakeable — consumers paying only for payments never load viem ENS or ERC-8004 code.

  - **`relay-register` CLI** (bin) — one-shot ERC-8004 agent registration. `--chain base | mainnet | base-sepolia`, `--agent-uri ipfs://...`, `--private-key-env <NAME>` (env var NAME, not value — flag arguments leak). Maps failures to `RegistrationError.step`.

  Sizes (brotli, upstream externalized): `/relay` 2.85 KB, main entry 5.56 KB, `cli/relay-register` 2.59 KB. 195 tests total; all 7 gates green.

- [#6](https://github.com/gosuda/portal-x402-sdk/pull/6) [`df02456`](https://github.com/gosuda/portal-x402-sdk/commit/df024565f8842572d4b007e44ab00046e7cf90b1) Thanks [@GrapeInTheTree](https://github.com/GrapeInTheTree)! - Sync `/relay` to portal-tunnel v2.1.7 wire format. **Breaking**:
  `PORTAL_TUNNEL_DISCOVERY_VERSION` bumped `'6' → '7'`, `RelayDescriptor`
  schema reshaped to the 13-field Go struct (fields dropped: `name`,
  `relayId`, `ownerAddress`, `ingressTlsAddr`, `wireguardEndpoint`,
  `overlayIpv4`, `overlayCidrs`, `discovery`, `supportsOverlayPeer`,
  `load`, `loadScore`, `lastUpdated`; renamed to `activeConnections` /
  `tcpBps`; added `signature`, `issuedAtNano`, `expiresAtNano`).

  New:

  - `PORTAL_TUNNEL_SDK_VERSION = '6'` constant for `/sdk/*` callers.
  - `hasOverlayPeer(relay)` helper mirrors `types.HasOverlayPeer`.
  - `relayDescriptorCanonicalBytes(descriptor)` produces byte-exact
    signing payloads matching Go's `types.CanonicalBytes`.
  - `verifyRelayDescriptorSignature({ descriptor })` verifies signed
    descriptors via SHA-256 + secp256k1 recover + EIP-55 address match.
  - `verifyPortalHost` now accepts the parsed descriptor directly and
    runs Layer 0 (signature verification) automatically when the
    descriptor is signed. `verifyDescriptorSignature: false` opts out
    for legacy unsigned bootstrap flows.
  - `RelayVerificationError` gains a `'signature-invalid'` reason.

  `selectBestRelay` removes the `requireDiscoveryFlag` option (the Go
  side no longer surfaces that flag on the wire) and ranks by
  `activeConnections` with `tcpBps` as the tiebreaker (higher throughput
  wins). Consumers can still override via `scoreRelay`.

- [#3](https://github.com/gosuda/portal-x402-sdk/pull/3) [`c4e1f92`](https://github.com/gosuda/portal-x402-sdk/commit/c4e1f9241eded331833b54381b4700482cbe2dc0) Thanks [@GrapeInTheTree](https://github.com/GrapeInTheTree)! - Add three thin-wrapper subpaths over the 2026-04-13 upstream release of `@x402/*`:

  - **`/auth`** — `createPortalSiwx()` wraps `@x402/extensions/sign-in-with-x` (CAIP-122 with EOA + EIP-1271 + EIP-6492) with portal defaults (`eip155:8453`, 10-minute expiry, SIWE-ABNF nonces via `viem/siwe`). `buildPortalTunnelChallengeMessage()` + `createPortalTunnelLeaseFlow()` produce a byte-equal SIWE message against `gosuda/portal-tunnel`'s `portal/auth/auth.go` lease-registration wire format (statement `"Register a portal lease"`, `chainId: 1`, 2-min expiry, RFC3339 timestamps) and drive the full `/sdk/register/challenge` → sign → `/sdk/register` flow. `createSiwxAuthHeaders()` drops into `createPortalFacilitator({ createAuthHeaders })` and attaches a fresh SIWX challenge (default `SIGN-IN-WITH-X` canonical header, opt-in `Authorization: Bearer` scheme) to each facilitator request.
  - **`/hono`** — `createPortalHonoMiddleware()` wraps `@x402/hono paymentMiddleware` + `x402ResourceServer`. Accepts our `PortalFacilitator` directly, pre-installs `OnVerifyFailureHook` / `OnSettleFailureHook` that remap upstream `FacilitatorResponseError` to our `FacilitatorError`, and reserves a `BeforeVerifyHook` slot (`trust.verifyHost`) for the portal host verification gate that lands in the identity fast-follow PR.
  - **`/client`** — `createPortalPaidFetch()` wraps `@x402/fetch wrapFetchWithPayment`. Accepts either a viem-compatible `ClientEvmSigner` (one-line shortcut: auto-registers `ExactEvmScheme` on `eip155:*` for both v2 and v1 via upstream's `registerExactEvmScheme`) or explicit `SchemeRegistration[]` for non-EVM setups. Supports upstream policies, custom `paymentRequirementsSelector`, and fetch injection.

  Wire-level payment handshake, `PAYMENT-SIGNATURE` encoding, paywall HTML, scheme dispatch, and loop prevention are owned entirely by upstream — this SDK adds Portal-specific defaults, one unified error hierarchy via `FacilitatorError`, and the `portal-tunnel` SIWE wire bridge that TypeScript consumers cannot get anywhere else. Measured sizes (brotli, with `@x402/*` + `viem` externalized): `/auth` 1.47 KB, `/hono` 874 B, `/client` 452 B.

- [#7](https://github.com/gosuda/portal-x402-sdk/pull/7) [`853a847`](https://github.com/gosuda/portal-x402-sdk/commit/853a84730e7971d15af5cf38a3e610a7945d40a5) Thanks [@GrapeInTheTree](https://github.com/GrapeInTheTree)! - Extract Layer 4 of `verifyPortalHost` into a pluggable `TrustAnchor`
  interface. The ENS DAO is actively debating successors to ENSIP-25
  (ENSIP-26 "ENS Native AI Identity" + an `agent.arp` forum proposal),
  and hard-coupling to a single standard would force a breaking change
  the day either lands. Now we don't.

  `verifyPortalHost` accepts an optional `trustAnchors: readonly
TrustAnchor[]`. Behavior unchanged by default — the SDK internally
  wires `[ensip25TrustAnchor({ chainId, registryAddress })]` when
  `trustAnchors` is omitted, so existing consumers see the same happy
  path. Supplying the argument replaces the default entirely (AND
  semantics across all anchors). Passing `[]` skips Layer 4 for advanced
  callers who proved the ENS↔agent binding out-of-band.

  New exports from `/relay`:

  - `TrustAnchor` — interface with `name: string` + `verify(context)`.
  - `TrustAnchorContext` — shared `{ host, ensName, expectedAgentId,
advertisedAddress, ensClient, identityRegistry }`.
  - `ensip25TrustAnchor(config)` — factory for the default adapter.

  `VerifyPortalHostResult` gains a `trustAnchors: readonly string[]`
  field that lists, in execution order, the names of the anchors that
  passed. Useful for logging + observability when multiple anchors
  compose.
