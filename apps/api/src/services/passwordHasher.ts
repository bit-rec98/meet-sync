import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

// OWASP minimum for Argon2id: 19 MiB of memory, 2 passes, 1 lane. The parameters are stored inside
// each hash, so they can be raised later without invalidating existing passwords.
const MEMORY_KIB = 19456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

// Upper bounds for parameters read back from storage, so a corrupted row cannot make a
// verification consume unbounded memory or time.
const MAX_MEMORY_KIB = 262144;
const MAX_PASSES = 10;
const MAX_PARALLELISM = 4;

// PHC string format: $argon2id$v=19$m=<memory>,t=<passes>,p=<lanes>$<salt>$<hash> (unpadded base64)
const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

type Argon2Cost = { memory: number; passes: number; parallelism: number };

function deriveKey(
  password: string,
  salt: Buffer,
  cost: Argon2Cost,
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, tagLength, ...cost }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

const toUnpaddedBase64 = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');

/** Returns a self-describing Argon2id hash (PHC string) with a fresh random salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const cost = { memory: MEMORY_KIB, passes: PASSES, parallelism: PARALLELISM };
  const key = await deriveKey(password, salt, cost, TAG_BYTES);
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${toUnpaddedBase64(salt)}$${toUnpaddedBase64(key)}`;
}

/** Constant-time check. Returns false, and never throws, for a wrong password or a malformed hash. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(storedHash);
  if (!match) return false;

  const [, memory, passes, parallelism, saltText, keyText] = match;
  const cost = {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
  };
  const costIsInBounds =
    cost.parallelism >= 1 &&
    cost.parallelism <= MAX_PARALLELISM &&
    cost.memory >= 8 * cost.parallelism &&
    cost.memory <= MAX_MEMORY_KIB &&
    cost.passes >= 1 &&
    cost.passes <= MAX_PASSES;
  if (!costIsInBounds) return false;

  const salt = Buffer.from(saltText ?? '', 'base64');
  const expected = Buffer.from(keyText ?? '', 'base64');
  if (salt.length < 8 || expected.length < 4) return false;

  try {
    const actual = await deriveKey(password, salt, cost, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
