import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import { createApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config/env.js';
import type { LogEntry } from '../http/logger.js';
import type { RateLimitSettings } from '../http/middleware/rateLimits.js';
import { createTestPool } from './database.js';

const HOUR_MS = 60 * 60 * 1000;
const NO_PRACTICAL_LIMIT = { windowMs: HOUR_MS, limit: 100_000 };

/** Limits high enough to never interfere. Rate-limit tests pass their own settings. */
export const LENIENT_RATE_LIMITS: RateLimitSettings = {
  register: NO_PRACTICAL_LIMIT,
  loginPerIp: NO_PRACTICAL_LIMIT,
  loginPerEmail: NO_PRACTICAL_LIMIT,
  refresh: NO_PRACTICAL_LIMIT,
};

export type TestContext = {
  app: Express;
  pool: Pool;
  config: AppConfig;
  /** Every log entry written by the app, in order. */
  logs: LogEntry[];
  /** Controls the time the app sees. Starts at the real current time. */
  clock: { current: Date };
  close(): Promise<void>;
};

/** An app wired to the test database, an adjustable clock, captured logs, and lenient limits. */
export function createTestContext(
  options: { rateLimits?: RateLimitSettings; secureCookies?: boolean } = {},
): TestContext {
  const pool = createTestPool();
  const config: AppConfig = { ...loadConfig(), secureCookies: options.secureCookies ?? false };
  const logs: LogEntry[] = [];
  const clock = { current: new Date() };
  const app = createApp({
    pool,
    config,
    now: () => clock.current,
    log: (entry) => logs.push(entry),
    rateLimits: options.rateLimits ?? LENIENT_RATE_LIMITS,
  });
  return { app, pool, config, logs, clock, close: () => pool.end() };
}
