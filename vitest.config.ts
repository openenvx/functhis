import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['test/real-servers.test.ts'],
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
