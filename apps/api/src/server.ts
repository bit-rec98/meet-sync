import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { assertDatabaseReachable, createPool } from './db/pool.js';

const config = loadConfig();
const pool = createPool(config.database);
await assertDatabaseReachable(pool); // fail fast if the database is unreachable
const server = createServer(createApp({ pool, config }));

server.listen(config.port, () => {
  console.info(`API listening on port ${config.port} (${config.nodeEnv})`);
});

function shutdown(signal: string): void {
  console.info(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
