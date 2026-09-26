import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    // The default in-memory database is PostgreSQL compiled to WebAssembly; import tests need headroom.
    testTimeout: 30_000,
  },
});
