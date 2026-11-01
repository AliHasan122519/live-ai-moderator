import { defineConfig } from 'vitest/config';

const testDb = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/tiktok_publisher_test';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    env: { DATABASE_URL: testDb },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
