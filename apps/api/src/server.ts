import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();
const server = createServer(createApp());

server.listen(config.port, () => {
  console.info(`API listening on port ${config.port} (${config.nodeEnv})`);
});

function shutdown(signal: string): void {
  console.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
