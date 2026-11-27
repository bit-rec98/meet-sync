import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
};

/**
 * Parses and validates environment variables once, at startup.
 * Fails fast with the names of the invalid variables (never their values).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const invalid = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment configuration: ${invalid.join(', ')}`);
  }
  return { nodeEnv: result.data.NODE_ENV, port: result.data.API_PORT };
}
