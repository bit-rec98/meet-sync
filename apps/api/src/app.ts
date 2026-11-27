import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';

const handleUnexpectedError: ErrorRequestHandler = (error, _req, res, _next) => {
  // Log internally; never expose error details to the client.
  console.error('Unhandled request error', error instanceof Error ? error.name : 'unknown');
  res.status(500).json({ error: { code: 'internal_error' } });
};

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found' } });
  });
  app.use(handleUnexpectedError);

  return app;
}
