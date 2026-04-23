import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'auth/index': 'src/auth/index.ts',
    'hono/index': 'src/hono/index.ts',
    'client/index': 'src/client/index.ts',
    'relay/index': 'src/relay/index.ts',
    'facilitator/index': 'src/facilitator/index.ts',
    'erc8004/index': 'src/erc8004/index.ts',
    'ensip25/index': 'src/ensip25/index.ts',
    'errors/index': 'src/errors/index.ts',
    'cli/relay-register': 'src/cli/relay-register.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: true,
  treeshake: true,
  shims: true,
  external: [
    'hono',
    'viem',
    '@x402/core',
    '@x402/evm',
    '@x402/extensions',
    '@x402/fetch',
    '@x402/hono',
  ],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' }
  },
})
