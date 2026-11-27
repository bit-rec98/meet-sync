import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import { createApp, createServices, type AppServices } from '../app.js';
import { loadConfig, type AppConfig, type SignalingConfig } from '../config/env.js';
import type { LogEntry } from '../http/logger.js';
import type { RateLimitSettings } from '../http/middleware/rateLimits.js';
import {
  createSignaling,
  type Signaling,
  type SignalingDependencies,
} from '../signaling/gateway.js';
import { createTestPool } from './database.js';

const HOUR_MS = 60 * 60 * 1000;
const NO_PRACTICAL_LIMIT = { windowMs: HOUR_MS, limit: 100_000 };

/** Limits high enough to never interfere. Rate-limit tests pass their own settings. */
export const LENIENT_RATE_LIMITS: RateLimitSettings = {
  register: NO_PRACTICAL_LIMIT,
  loginPerIp: NO_PRACTICAL_LIMIT,
  loginPerEmail: NO_PRACTICAL_LIMIT,
  refresh: NO_PRACTICAL_LIMIT,
  invite: NO_PRACTICAL_LIMIT,
  signaling: NO_PRACTICAL_LIMIT,
};

export type TestContext = {
  app: Express;
  pool: Pool;
  config: AppConfig;
  services: AppServices;
  /** Every log entry written by the app, in order. */
  logs: LogEntry[];
  /** Controls the time the app sees. Starts at the real current time. */
  clock: { current: Date };
  close(): Promise<void>;
};

/** An app wired to the test database, an adjustable clock, captured logs, and lenient limits. */
export function createTestContext(
  options: {
    rateLimits?: RateLimitSettings;
    secureCookies?: boolean;
    signaling?: Partial<SignalingConfig>;
  } = {},
): TestContext {
  const pool = createTestPool();
  const loaded = loadConfig();
  const config: AppConfig = {
    ...loaded,
    secureCookies: options.secureCookies ?? false,
    signaling: { ...loaded.signaling, ...options.signaling },
  };
  const logs: LogEntry[] = [];
  const clock = { current: new Date() };
  const now = () => clock.current;
  const log = (entry: LogEntry): void => void logs.push(entry);
  const services = createServices({ pool, config, now, log });
  const app = createApp({
    pool,
    config,
    now,
    log,
    services,
    rateLimits: options.rateLimits ?? LENIENT_RATE_LIMITS,
  });
  return { app, pool, config, services, logs, clock, close: () => pool.end() };
}

export type RunningSignalingServer = {
  /** `http://127.0.0.1:<port>` */
  httpUrl: string;
  /** `ws://127.0.0.1:<port>` */
  wsUrl: string;
  signaling: Signaling;
  close(): Promise<void>;
};

/**
 * Starts a real HTTP server on a free port with the WebSocket gateway attached, using the
 * context's app, services, clock and log. Options override the gateway for a test.
 */
export async function startSignalingServer(
  context: TestContext,
  overrides: Partial<
    Pick<SignalingDependencies, 'authorizeJoin' | 'maxParticipants' | 'options'>
  > = {},
): Promise<RunningSignalingServer> {
  const server = createServer(context.app);
  const { services, config } = context;
  const signaling = createSignaling({
    httpServer: server,
    tickets: services.tickets,
    authorizeJoin: (userId, meetingId) => services.meetings.assertCanJoin(userId, meetingId),
    events: services.events,
    webOrigins: config.webOrigins,
    maxParticipants: config.signaling.maxParticipants,
    log: (entry) => void context.logs.push(entry),
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    signaling,
    async close() {
      await signaling.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
