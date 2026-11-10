import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/server/test/**/*.test.ts', 'packages/shared/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
