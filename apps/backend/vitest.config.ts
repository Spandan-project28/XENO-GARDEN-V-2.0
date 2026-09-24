import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Share one MongoDB binary download across all workspaces (repo-root node_modules/.cache).
process.env.MONGOMS_DOWNLOAD_DIR ??= fileURLToPath(
  new URL('../../node_modules/.cache/mongodb-memory-server', import.meta.url),
);

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'int',
          include: ['test/int/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 120_000,
          // one in-memory Mongo per file; run files serially to keep memory low
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
