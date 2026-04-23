import { defineConfig } from 'tsup'

// Library subpaths — shipped with DTS.
const LIBRARY_ENTRIES = {
  index: 'src/index.ts',
  'auth/index': 'src/auth/index.ts',
  'hono/index': 'src/hono/index.ts',
  'client/index': 'src/client/index.ts',
  'relay/index': 'src/relay/index.ts',
  'facilitator/index': 'src/facilitator/index.ts',
  'erc8004/index': 'src/erc8004/index.ts',
  'ensip25/index': 'src/ensip25/index.ts',
  'errors/index': 'src/errors/index.ts',
}

// The CLI bin entry is built separately so we can (a) skip DTS generation
// and (b) prepend the Node shebang via esbuild banner without contaminating
// library outputs.
const CLI_ENTRY = { 'cli/relay-register': 'src/cli/relay-register.ts' }

const SHARED = {
  format: ['esm', 'cjs'] as const,
  sourcemap: true,
  clean: false,
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
  outExtension({ format }: { format: 'esm' | 'cjs' }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' }
  },
}

export default defineConfig([
  {
    ...SHARED,
    entry: LIBRARY_ENTRIES,
    dts: true,
    clean: true,
  },
  {
    ...SHARED,
    entry: CLI_ENTRY,
    dts: false,
    esbuildOptions(options) {
      options.banner = { js: '#!/usr/bin/env node\n' }
    },
  },
])
