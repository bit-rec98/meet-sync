import { defineConfig } from 'vitest/config';

// Tests run against the test database (DB_TEST_NAME), never the development one.
// Values from the repository's .env are loaded when present; variables already set (CI) win.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // No .env file: rely on the environment.
}
process.env['NODE_ENV'] = 'test';
process.env['DB_NAME'] = process.env['DB_TEST_NAME'] ?? 'meet_sync_test';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/test/globalSetup.ts'],
    fileParallelism: false, // integration tests share one database
  },
});
