import type { AppConfig } from '../config/env.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * The seed command writes accounts with a published password, so it must never reach a database
 * that anyone else can use. Returns what is wrong, or null when it is safe to go on. The messages
 * name the setting, never its value.
 */
export function seedRefusal(config: AppConfig): string | null {
  if (config.nodeEnv !== 'development') {
    return 'NODE_ENV must be "development" (or unset) to create test accounts.';
  }
  if (!LOCAL_HOSTS.has(config.database.host)) {
    return 'DB_HOST must be this machine (localhost or 127.0.0.1): the test accounts have a published password.';
  }
  if (config.database.database.endsWith('_test')) {
    return 'DB_NAME points at the automated tests’ database, which they empty on every run.';
  }
  return null;
}
