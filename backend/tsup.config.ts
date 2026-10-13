import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vercel: 'src/vercel.ts',
    'migrate-cli': 'src/db/migrate-cli.ts',
    'seed-cli': 'src/db/seed-cli.ts',
    'deploy-cli': 'src/db/deploy-cli.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // the shared workspace package is TypeScript source — bundle it in
  noExternal: ['@pjd/shared'],
})
