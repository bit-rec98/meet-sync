import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestContext } from './test/app.js';

describe('createApp', () => {
  const context = createTestContext();
  const { app } = context;
  afterAll(() => context.close());

  it('reports health', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns a generic JSON 404 for unknown routes and unsupported methods', async () => {
    const unknown = await request(app).get('/api/v1/does-not-exist');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: { code: 'not_found', message: 'Resource not found.' } });

    const wrongMethod = await request(app).get('/api/v1/auth/login');
    expect(wrongMethod.status).toBe(404);
  });

  it('sends security headers and hides the framework', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('gives every response a request id and logs one line per request without the query string', async () => {
    context.logs.length = 0;
    const response = await request(app).get('/api/v1/health?token=do-not-log-this');
    const requestId = response.headers['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    expect(context.logs).toHaveLength(1);
    expect(context.logs[0]).toMatchObject({
      event: 'request',
      requestId,
      method: 'GET',
      path: '/api/v1/health',
      status: 200,
    });
    expect(JSON.stringify(context.logs)).not.toContain('do-not-log-this');
  });
});

describe('unexpected failures', () => {
  it('answer with a generic 500 and log only the kind of error', async () => {
    const broken = createTestContext();
    await broken.close(); // every database call from now on fails
    broken.logs.length = 0;

    const response = await request(broken.app)
      .post('/api/v1/auth/login')
      .send({ email: 'ana@example.test', password: 'a-password-value' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'internal_error', message: 'Something went wrong.' },
    });
    const errorLog = broken.logs.find((entry) => entry['event'] === 'unhandled_error');
    expect(errorLog).toMatchObject({ event: 'unhandled_error', errorName: expect.any(String) });
    expect(JSON.stringify(broken.logs)).not.toContain('a-password-value');
    expect(JSON.stringify(response.body)).not.toMatch(/pool|mysql|sql|stack/i);
  });
});
