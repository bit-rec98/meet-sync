import { z } from 'zod';

const portSchema = z.coerce.number().int().min(1).max(65535);
const nonEmpty = z.string().min(1);

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/** Comma-separated list of origins such as `https://app.example.com` (no path, no trailing slash). */
const originListSchema = z
  .string()
  .transform((value) => value.split(',').map((entry) => entry.trim()))
  .refine((origins) => origins.length > 0 && origins.every(isOrigin));

const ICE_URL = /^(stuns?|turns?):[^\s,]+$/;

/** Comma-separated ICE server URLs such as `stun:stun.example.com:3478`; empty means none. */
const iceUrlListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  )
  .refine((urls) => urls.every((url) => ICE_URL.test(url)));

const participantLimitSchema = z.coerce.number().int().min(2).max(50);

const runtimeEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: portSchema.default(3000),
    DB_HOST: nonEmpty,
    DB_PORT: portSchema,
    DB_NAME: nonEmpty,
    DB_USER: nonEmpty,
    DB_PASSWORD: nonEmpty,
    // HS256 signing key for access tokens: at least 32 characters of random data.
    JWT_ACCESS_SECRET: z.string().min(32),
    WEB_ORIGINS: originListSchema,
    // Number of reverse proxies in front of the API whose X-Forwarded-For header is trusted.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // Largest number of people in one call. Calls are peer-to-peer, so each added person costs
    // every other person bandwidth and CPU, which is why video allows far fewer than audio.
    MAX_PARTICIPANTS_AUDIO: participantLimitSchema.default(10),
    MAX_PARTICIPANTS_VIDEO: participantLimitSchema.default(4),
    // STUN servers help browsers find their public address. Public ones are fine for development.
    STUN_URLS: iceUrlListSchema.default(['stun:stun.cloudflare.com:3478']),
    // Optional TURN relay, for people behind restrictive networks. Credentials are generated
    // per user with the shared secret (the same one configured in the TURN server).
    TURN_URLS: iceUrlListSchema.default([]),
    TURN_SHARED_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, context) => {
    if (env.TURN_URLS.length > 0 && env.TURN_SHARED_SECRET === undefined) {
      context.addIssue({ code: 'custom', path: ['TURN_SHARED_SECRET'], message: 'required' });
    }
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
  accessTokenSecret: string;
  /** Origins of the web app allowed to call cookie-authenticated routes. */
  webOrigins: string[];
  trustProxyHops: number;
  /** Refresh-cookie `Secure` attribute: on in production, off for local development and tests. */
  secureCookies: boolean;
  signaling: SignalingConfig;
};

export type SignalingConfig = {
  maxParticipants: { audio: number; video: number };
  stunUrls: string[];
  /** Present only when a TURN relay is configured. */
  turn: { urls: string[]; sharedSecret: string } | null;
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
    accessTokenSecret: parsed.JWT_ACCESS_SECRET,
    webOrigins: parsed.WEB_ORIGINS,
    trustProxyHops: parsed.TRUST_PROXY_HOPS,
    secureCookies: parsed.NODE_ENV === 'production',
    signaling: {
      maxParticipants: {
        audio: parsed.MAX_PARTICIPANTS_AUDIO,
        video: parsed.MAX_PARTICIPANTS_VIDEO,
      },
      stunUrls: parsed.STUN_URLS,
      turn:
        parsed.TURN_URLS.length > 0 && parsed.TURN_SHARED_SECRET !== undefined
          ? { urls: parsed.TURN_URLS, sharedSecret: parsed.TURN_SHARED_SECRET }
          : null,
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
