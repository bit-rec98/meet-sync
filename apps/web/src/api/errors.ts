import type { FieldIssue } from './types';

/** The error codes of the API, plus two produced locally. */
export const API_ERROR_CODES = [
  'invalid_credentials',
  'unauthorized',
  'email_taken',
  'validation_error',
  'forbidden',
  'not_found',
  'user_not_found',
  'already_invited',
  'invitee_limit_reached',
  'invalid_state',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'internal_error',
] as const;

export type ApiErrorCode =
  | (typeof API_ERROR_CODES)[number]
  /** The request never got an answer (offline, server down, blocked). */
  | 'network_error'
  /** The answer was not in the expected format. */
  | 'unknown_error';

const isApiErrorCode = (value: unknown): value is (typeof API_ERROR_CODES)[number] =>
  typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);

const isFieldIssue = (value: unknown): value is FieldIssue =>
  typeof value === 'object' &&
  value !== null &&
  'path' in value &&
  typeof value.path === 'string' &&
  'code' in value &&
  typeof value.code === 'string';

/**
 * A failed API call. The UI decides what to show from `code` (translated texts), never from the
 * server's English message, which is deliberately not kept.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: FieldIssue[];
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    details?: FieldIssue[];
    retryAfterSeconds?: number;
  }) {
    super(init.code);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** Builds the error from a non-successful response, tolerating bodies that are not our JSON. */
  static async fromResponse(response: Response): Promise<ApiError> {
    let code: ApiErrorCode = 'unknown_error';
    let details: FieldIssue[] = [];
    try {
      const body: unknown = await response.json();
      const error =
        typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
      if (typeof error === 'object' && error !== null) {
        if ('code' in error && isApiErrorCode(error.code)) code = error.code;
        if ('details' in error && Array.isArray(error.details)) {
          details = error.details.filter(isFieldIssue);
        }
      }
    } catch {
      // Not JSON (for example an HTML error page from a proxy): keep the generic code.
    }
    const retryAfter = Number(response.headers.get('Retry-After'));
    return new ApiError({
      status: response.status,
      code,
      details,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    });
  }
}
