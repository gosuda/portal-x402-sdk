---
'@portal-tunnel/x402-sdk': minor
---

Add the `/errors` subpath with a viem-style `BaseError` hierarchy and seven concrete leaf classes: `PaymentRequiredError`, `FacilitatorError`, `VerificationError`, `RelayDiscoveryError`, `RelayVerificationError`, `IdentityLookupError`, `RegistrationError`. Each subclass is an immutable `readonly` class with a single options-object constructor, a literal `name` discriminator (`override readonly name = 'XxxError' as const`), and native `Error.cause` chaining with a `walk()` traversal helper on the base. Exports a `PortalErrorName` discriminator union for exhaustive `switch` handling.
