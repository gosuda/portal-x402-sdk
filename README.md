# portal-x402-sdk

> TypeScript SDK that wraps x402 payment + ERC-8004 identity + ENSIP-25 verification for portal-tunnel relay networks.

**Status**: pre-release — `@portal-tunnel/x402-sdk@0.1.0-rc.1` on the `next` tag.

```bash
npm i @portal-tunnel/x402-sdk@next
```

> **Note**: the npm package is `@portal-tunnel/x402-sdk` while the GitHub repo slug is `gosuda/portal-x402-sdk`. The `@gosuda` npm scope was already taken; the gosuda team provisioned the `@portal-tunnel` scope instead.

## Packages

| Package | Description |
|---|---|
| [`@portal-tunnel/x402-sdk`](./packages/sdk) | Hono middleware, paid fetch, relay selection, ERC-8004 identity, ENSIP-25 verification |

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm lint
```

See [`packages/sdk/README.md`](./packages/sdk/README.md) for installation and usage.

## Related projects

- [portal-tunnel](https://github.com/gosuda/portal-tunnel) — Trustless relay network (Go)
- [x402-facilitator](https://github.com/gosuda/x402-facilitator) — x402 payment facilitator (Go)

## License

MIT
