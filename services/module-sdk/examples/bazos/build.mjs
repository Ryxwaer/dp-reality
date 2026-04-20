import { build } from 'esbuild'

await build({
  entryPoints: ['src/module.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/module.mjs',
  legalComments: 'none',
  minify: false
})

console.log('\u001b[32m✓\u001b[0m built dist/module.mjs (bazos)')
