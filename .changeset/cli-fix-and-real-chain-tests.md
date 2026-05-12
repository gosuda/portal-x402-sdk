---
'@portal-tunnel/x402-sdk': patch
---

Fix CLI entrypoint detection so `relay-register` works after `npm install`, and add real-chain + anvil-fork integration tests against Base mainnet.

**Bug fix (CLI)**: the previous entrypoint check used `process.argv[1]?.endsWith('relay-register.mjs')`, which is `false` when the bin is invoked via the npm `.bin/relay-register` symlink (no `.mjs` suffix on `argv[1]`). The CLI ran in dev (`node dist/cli/relay-register.mjs`) but silently exited with code 0 and no output after `npm install`. Replaced with `isCliEntrypoint()` which compares the realpath of `import.meta.url` against the realpath of `process.argv[1]` — the canonical ESM "am I the entry point" check, robust to symlinks.

**New tests** (+10 total, 231 → 241):

- `cli/relay-register.test.ts` — `isCliEntrypoint()` regression test + 2 bin smoke tests that `execFile` the built `.mjs` and assert `--help` / `--version` output (covers the symlink invocation path the old check missed)
- `erc8004/identity-registry.real-chain.test.ts` — 5 read-only assertions against live Base mainnet via the public RPC: contract deployed at the canonical Identity Registry address, client binds correctly by chainId, non-existent agent surfaces as `IdentityLookupError`, Reputation Registry also deployed. Skips cleanly on RPC unreachable
- `erc8004/identity-registry.anvil.test.ts` — end-to-end write test: spawns anvil forking Base mainnet, funds the test wallet via `anvil_setBalance`, clears any pre-deployed code at the dev key address via `anvil_setCode` (anvil's deterministic dev keys are public, so people have deployed contracts at those addresses on real mainnets — this matters because the contract's `onERC721Received` callback would otherwise transfer the freshly-minted NFT away and revert `register()`), resets the nonce, then calls `register(agentURI)` and verifies the `Registered` event parse + `tokenURI` round-trip + `getOwner` matches. Skips cleanly when anvil is not installed

**Misc**:

- `.size-limit.json` ignores `fs` + `url` for the CLI bundle (esbuild strips the `node:` prefix, which is fine at runtime but confuses size-limit's bundler)
