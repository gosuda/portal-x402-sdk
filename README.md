# @gosuda/portal-x402-sdk

> TypeScript SDK that wraps x402 payment + ERC-8004 identity + ENSIP-25 verification for portal-tunnel relay networks.

**Status**: pre-release (0.1.0 in development)

## Install

```bash
pnpm add @gosuda/portal-x402-sdk hono viem
```

## Quickstart — Hono paywall

```ts
import { x402 } from '@gosuda/portal-x402-sdk/hono'
import { Hono } from 'hono'

const app = new Hono()

app.get(
  '/premium',
  x402({
    amount: 100_000n,
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    recipient: '0xYourTreasury',
    facilitator: 'https://facilitator.portal.gosuda.dev',
    network: 'eip155:8453',
  }),
  (c) => c.json({ article: '...' }),
)

export default app
```

## License

MIT
