import { describe, expect, it } from 'vitest';
import { loadConfig, loadMigrationDatabaseConfig } from './env.js';

const databaseEnv = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_NAME: 'app_db',
  DB_USER: 'runtime_user',
  DB_PASSWORD: 'runtime-secret-value',
  DB_MIGRATION_USER: 'migration_user',
  DB_MIGRATION_PASSWORD: 'migration-secret-value',
};

describe('loadConfig', () => {
  it('applies defaults and maps the runtime database account', () => {
    expect(loadConfig(databaseEnv)).toEqual({
      nodeEnv: 'development',
      port: 3000,
      database: {
        host: '127.0.0.1',
        port: 3307,
        database: 'app_db',
        user: 'runtime_user',
        password: 'runtime-secret-value',
      },
    });
  });

  it('reads explicit values', () => {
    const config = loadConfig({ ...databaseEnv, NODE_ENV: 'production', API_PORT: '8080' });
    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
  });

  it('rejects an invalid port and names the variable without echoing its value', () => {
    const attempt = () => loadConfig({ ...databaseEnv, API_PORT: 'not-a-port' });
    expect(attempt).toThrow(/API_PORT/);
    expect(attempt).not.toThrow(/not-a-port/);
  });

  it('requires database settings and never echoes secrets', () => {
    const { DB_PASSWORD: _omitted, ...withoutPassword } = databaseEnv;
    const attempt = () => loadConfig(withoutPassword);
    expect(attempt).toThrow(/DB_PASSWORD/);
    expect(attempt).not.toThrow(/runtime-secret-value/);
  });
});

describe('loadMigrationDatabaseConfig', () => {
  it('uses the migration account, not the runtime one', () => {
    const config = loadMigrationDatabaseConfig(databaseEnv);
    expect(config.user).toBe('migration_user');
    expect(config.password).toBe('migration-secret-value');
  });

  it('requires the migration credentials', () => {
    const { DB_MIGRATION_USER: _omitted, ...incomplete } = databaseEnv;
    expect(() => loadMigrationDatabaseConfig(incomplete)).toThrow(/DB_MIGRATION_USER/);
  });
});
