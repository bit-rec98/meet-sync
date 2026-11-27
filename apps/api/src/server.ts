import { createServer } from 'node:http';
import { createApp, createServices } from './app.js';
import { loadConfig } from './config/env.js';
import { assertDatabaseReachable, createPool } from './db/pool.js';
import { consoleLogger } from './http/logger.js';
import { createSignaling } from './signaling/gateway.js';

const config = loadConfig();
const pool = createPool(config.database);
await assertDatabaseReachable(pool); // fail fast if the database is unreachable

const services = createServices({ pool, config });
const server = createServer(createApp({ pool, config, services }));
const signaling = createSignaling({
  httpServer: server,
  tickets: services.tickets,
  authorizeJoin: (userId, meetingId) => services.meetings.assertCanJoin(userId, meetingId),
  events: services.events,
  webOrigins: config.webOrigins,
  maxParticipants: config.signaling.maxParticipants,
  log: consoleLogger,
});

server.listen(config.port, () => {
  console.info(`API listening on port ${config.port} (${config.nodeEnv})`);
});

async function shutdown(signal: string): Promise<void> {
  console.info(`${signal} received, shutting down`);
  await signaling.close(); // tells everyone in a call before the server goes away
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
