---
'@portal-tunnel/x402-sdk': minor
---

Extract Layer 4 of `verifyPortalHost` into a pluggable `TrustAnchor`
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
