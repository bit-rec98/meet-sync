import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.js';
import { seedRefusal } from './guard.js';

const SECRET_MARKERS = ['runtime-password-marker', 'jwt-secret-marker'];

const base: Record<string, string> = {
  NODE_ENV: 'development',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_NAME: 'meet_sync',
  DB_USER: 'app',
  DB_PASSWORD: SECRET_MARKERS[0] as string,
  JWT_ACCESS_SECRET: `${SECRET_MARKERS[1]}-0123456789abcdef`,
  WEB_ORIGINS: 'http://localhost:5173',
};

const config = (overrides: Record<string, string> = {}) => loadConfig({ ...base, ...overrides });

describe('seedRefusal', () => {
  it('allows the local development database', () => {
    expect(seedRefusal(config())).toBeNull();
    expect(seedRefusal(config({ DB_HOST: 'localhost' }))).toBeNull();
    expect(seedRefusal(config({ DB_HOST: '::1' }))).toBeNull();
  });

  it('treats an unset NODE_ENV as development, which is what loadConfig defaults to', () => {
    const { NODE_ENV: _unset, ...withoutNodeEnv } = base;
    expect(seedRefusal(loadConfig(withoutNodeEnv))).toBeNull();
  });

  it('refuses production and test environments', () => {
    for (const nodeEnv of ['production', 'test']) {
      expect(seedRefusal(config({ NODE_ENV: nodeEnv })), nodeEnv).toMatch(/NODE_ENV/);
    }
  });

  it('refuses a database on another machine', () => {
    for (const host of ['db.example.com', '10.0.0.5', '192.168.1.20', '127.0.0.1.evil.example']) {
      expect(seedRefusal(config({ DB_HOST: host })), host).toMatch(/DB_HOST/);
    }
  });

  it('refuses the automated tests’ database', () => {
    expect(seedRefusal(config({ DB_NAME: 'meet_sync_test' }))).toMatch(/DB_NAME/);
  });

  it('never puts a setting’s value in its message', () => {
    const cases: Record<string, string>[] = [
      { NODE_ENV: 'production' },
      { DB_HOST: 'secret-host.example.com' },
      { DB_NAME: 'secret_name_test' },
    ];
    for (const overrides of cases) {
      const message = seedRefusal(config(overrides)) ?? '';
      for (const value of [...Object.values(overrides), ...SECRET_MARKERS]) {
        expect(message).not.toContain(value);
      }
    }
  });
});
