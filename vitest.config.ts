import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Alias workspace packages to source so tests never run against a stale
// dist, and so a failing build cannot mask a passing suite.
export default defineConfig({
  resolve: {
    alias: {
      '@gitlab-unfurl-teams/core': src('./packages/core/src/index.ts'),
      '@gitlab-unfurl-teams/app': src('./packages/app/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'hosts/**/test/**/*.test.ts', 'manifest/test/**/*.test.ts'],
  },
});
