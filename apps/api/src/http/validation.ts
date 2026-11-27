import type { z } from 'zod';
import { HttpError, type ErrorDetail } from './errorResponse.js';

const MAX_DETAILS = 20;
const MAX_REPORTED_KEY_LENGTH = 50;

function toErrorDetails(error: z.ZodError): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        details.push({ path: key.slice(0, MAX_REPORTED_KEY_LENGTH), code: 'unrecognized_key' });
      }
    } else {
      details.push({ path: issue.path.join('.'), code: issue.code });
    }
  }
  return details.slice(0, MAX_DETAILS);
}

/**
 * Validates an untrusted request body. On failure it throws a 400 whose details name the fields and
 * the broken rules, never the submitted values (a password must not be echoed back).
 */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new HttpError(400, 'validation_error', toErrorDetails(result.error));
}
