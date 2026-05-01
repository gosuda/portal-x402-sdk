---
'@portal-tunnel/x402-sdk': minor
---

Add portal-identity primitives:

- **`/ensip25`** — `deriveEnsip25Key({ chainId, registryAddress, agentId })` produces the canonical `agent-registration[<erc7930-hex>][<agentId>]` text record key via `@wonderland/interop-addresses`. `crossCheckEnsip25()` verifies an ENS-name ↔ ERC-8004 agent-id binding using viem's `getEnsText` + the Identity Registry client, throwing `RelayVerificationError` with `reason='ensip25-mismatch'` on any mismatch.
- **`/erc8004`** — `ERC8004_ADDRESSES` frozen literal-union map (Ethereum + Base mainnet share the same CREATE2 vanity; Base Sepolia testnet vanity separately). `createIdentityRegistryClient()` wraps the ERC-721-based registry (register overloads, tokenURI/getAgentWallet/ownerOf reads, setAgentURI/setMetadata writes). `createReputationRegistryClient()` wraps the feedback-based reputation registry (giveFeedback/revokeFeedback writes, readFeedback/getSummary reads). `buildRegistrationFile()` + `parseRegistrationFile()` produce and validate the Portal registration file JSON. `pinRegistrationFile(file, pinner)` helper accepts any consumer-provided `IpfsPinner = (bytes) => Promise<{ cid }>`, keeping SDK zero-vendor-coupling.

Also: extracts retry/abort HTTP helper from `/facilitator` into internal `src/internal/http.ts` for reuse; drops the obsolete `/schemes` subpath stub per ADR 001.

Sizes (brotli, with `@x402/*` + `viem` + `@wonderland/interop-addresses` + `zod` externalized): `/ensip25` 1 KB, `/erc8004` 2.81 KB. 158 tests total across the package.
