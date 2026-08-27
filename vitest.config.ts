import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['test/real-servers.test.ts'],
    include: ['test/**/*.test.ts'],
  },
});
