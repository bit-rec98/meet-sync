import { z } from 'zod';

const portSchema = z.coerce.number().int().min(1).max(65535);
const nonEmpty = z.string().min(1);

const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: portSchema.default(3000),
  DB_HOST: nonEmpty,
  DB_PORT: portSchema,
  DB_NAME: nonEmpty,
  DB_USER: nonEmpty,
  DB_PASSWORD: nonEmpty,
});

const migrationEnvSchema = z.object({
  DB_HOST: nonEmpty,
  DB_PORT: portSchema,
  DB_NAME: nonEmpty,
  DB_MIGRATION_USER: nonEmpty,
  DB_MIGRATION_PASSWORD: nonEmpty,
});

export type DatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  database: DatabaseConfig;
};

/**
 * Fails fast with the names of the invalid variables. Values are never included in the message
 * because some of them are secrets.
 */
function parseEnv<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const invalid = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment configuration: ${invalid.join(', ')}`);
  }
  return result.data;
}

/** Configuration of the running API. Uses the restricted runtime database account. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = parseEnv(runtimeEnvSchema, env);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.API_PORT,
    database: {
      host: parsed.DB_HOST,
      port: parsed.DB_PORT,
      database: parsed.DB_NAME,
      user: parsed.DB_USER,
      password: parsed.DB_PASSWORD,
    },
  };
}

/** Database settings for the migration command only. Uses the migration database account. */
export function loadMigrationDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const parsed = parseEnv(migrationEnvSchema, env);
  return {
    host: parsed.DB_HOST,
    port: parsed.DB_PORT,
    database: parsed.DB_NAME,
    user: parsed.DB_MIGRATION_USER,
    password: parsed.DB_MIGRATION_PASSWORD,
  };
}
