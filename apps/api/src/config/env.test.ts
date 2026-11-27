import { describe, expect, it } from 'vitest';
import { loadConfig, loadMigrationDatabaseConfig } from './env.js';

const SECRET = 'jwt-secret-value-that-is-long-enough-123456';

const databaseEnv = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_NAME: 'app_db',
  DB_USER: 'runtime_user',
  DB_PASSWORD: 'runtime-secret-value',
  DB_MIGRATION_USER: 'migration_user',
  DB_MIGRATION_PASSWORD: 'migration-secret-value',
};

const runtimeEnv = {
  ...databaseEnv,
  JWT_ACCESS_SECRET: SECRET,
  WEB_ORIGINS: 'http://localhost:5173',
};

describe('loadConfig', () => {
  it('applies defaults and maps the runtime settings', () => {
    expect(loadConfig(runtimeEnv)).toEqual({
      nodeEnv: 'development',
      port: 3000,
      database: {
        host: '127.0.0.1',
        port: 3307,
        database: 'app_db',
        user: 'runtime_user',
        password: 'runtime-secret-value',
      },
      accessTokenSecret: SECRET,
      webOrigins: ['http://localhost:5173'],
      trustProxyHops: 0,
      secureCookies: false,
    });
  });

  it('reads explicit values', () => {
    const config = loadConfig({
      ...runtimeEnv,
      NODE_ENV: 'production',
      API_PORT: '8080',
      TRUST_PROXY_HOPS: '1',
    });
    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.trustProxyHops).toBe(1);
  });

  it('marks refresh cookies Secure only in production', () => {
    expect(loadConfig({ ...runtimeEnv, NODE_ENV: 'production' }).secureCookies).toBe(true);
    expect(loadConfig({ ...runtimeEnv, NODE_ENV: 'development' }).secureCookies).toBe(false);
    expect(loadConfig({ ...runtimeEnv, NODE_ENV: 'test' }).secureCookies).toBe(false);
  });

  it('rejects an invalid port and names the variable without echoing its value', () => {
    const attempt = () => loadConfig({ ...runtimeEnv, API_PORT: 'not-a-port' });
    expect(attempt).toThrow(/API_PORT/);
    expect(attempt).not.toThrow(/not-a-port/);
  });

  it('requires database settings and never echoes secrets', () => {
    const { DB_PASSWORD: _omitted, ...withoutPassword } = runtimeEnv;
    const attempt = () => loadConfig(withoutPassword);
    expect(attempt).toThrow(/DB_PASSWORD/);
    expect(attempt).not.toThrow(/runtime-secret-value/);
  });

  it('requires an access-token secret of at least 32 characters, without echoing it', () => {
    const { JWT_ACCESS_SECRET: _omitted, ...withoutSecret } = runtimeEnv;
    expect(() => loadConfig(withoutSecret)).toThrow(/JWT_ACCESS_SECRET/);
    const short = () => loadConfig({ ...runtimeEnv, JWT_ACCESS_SECRET: 'too-short-secret' });
    expect(short).toThrow(/JWT_ACCESS_SECRET/);
    expect(short).not.toThrow(/too-short-secret/);
  });

  it('accepts several allowed origins', () => {
    const config = loadConfig({
      ...runtimeEnv,
      WEB_ORIGINS: 'http://localhost:5173, https://app.example.com',
    });
    expect(config.webOrigins).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('rejects allowed origins that are not bare origins', () => {
    for (const bad of [
      '',
      'localhost:5173',
      'https://app.example.com/',
      'https://app.example.com/path',
      'http://localhost:5173,',
      '*',
    ]) {
      expect(() => loadConfig({ ...runtimeEnv, WEB_ORIGINS: bad })).toThrow(/WEB_ORIGINS/);
    }
  });

  it('rejects an invalid number of trusted proxies', () => {
    for (const bad of ['-1', '1.5', 'many', '6']) {
      expect(() => loadConfig({ ...runtimeEnv, TRUST_PROXY_HOPS: bad })).toThrow(
        /TRUST_PROXY_HOPS/,
      );
    }
  });
});

describe('loadMigrationDatabaseConfig', () => {
  it('uses the migration account, not the runtime one', () => {
    const config = loadMigrationDatabaseConfig(databaseEnv);
    expect(config.user).toBe('migration_user');
    expect(config.password).toBe('migration-secret-value');
  });

  it('does not need the API-only settings (secret, origins)', () => {
    expect(() => loadMigrationDatabaseConfig(databaseEnv)).not.toThrow();
  });

  it('requires the migration credentials', () => {
    const { DB_MIGRATION_USER: _omitted, ...incomplete } = databaseEnv;
    expect(() => loadMigrationDatabaseConfig(incomplete)).toThrow(/DB_MIGRATION_USER/);
  });
});
