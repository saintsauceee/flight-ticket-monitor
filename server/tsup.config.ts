import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // `@shared/*` is resolved through tsconfig paths and bundled in;
  // npm dependencies (hono, better-sqlite3, ...) stay external.
});
