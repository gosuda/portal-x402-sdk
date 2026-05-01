---
'@portal-tunnel/x402-sdk': minor
---

Sync `/relay` to portal-tunnel v2.1.7 wire format. **Breaking**:
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
