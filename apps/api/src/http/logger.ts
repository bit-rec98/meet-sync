import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export type LogEntry = Record<string, unknown>;
export type Logger = (entry: LogEntry) => void;

/** One JSON object per line, ready for log aggregation. */
export const consoleLogger: Logger = (entry) => {
  console.info(JSON.stringify({ time: new Date().toISOString(), ...entry }));
};

/**
 * Logs one line per request: request id, method, path, status, duration, and user id when known.
 * It deliberately never reads bodies, headers, cookies or the query string, so passwords and
 * tokens cannot end up in the logs.
 */
export function requestLogger(log: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    res.locals['requestId'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const userId: unknown = res.locals['userId'];
      log({
        event: 'request',
        requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        ...(typeof userId === 'string' ? { userId } : {}),
      });
    });
    next();
  };
}
