import type { Response } from 'express';
import type { DomainErrorCode } from '../errors.js';

export type HttpErrorCode =
  | DomainErrorCode
  | 'validation_error'
  | 'forbidden'
  | 'not_found'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'internal_error';

/** Points at the offending field and the rule it broke. Never contains the submitted value. */
export type ErrorDetail = { path: string; code: string };

/** An error raised by the HTTP layer itself (as opposed to a business rule, see DomainError). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: HttpErrorCode,
    readonly details?: ErrorDetail[],
  ) {
    super(code);
    this.name = 'HttpError';
  }
}

/** Fixed, generic messages: nothing here depends on request data or internal state. */
const MESSAGES: Record<HttpErrorCode, string> = {
  invalid_credentials: 'Invalid email or password.',
  unauthorized: 'Authentication required.',
  email_taken: 'An account with this email already exists.',
  validation_error: 'Invalid request.',
  forbidden: 'You do not have permission to do this.',
  not_found: 'Resource not found.',
  payload_too_large: 'Request body is too large.',
  unsupported_media_type: 'Content-Type must be application/json.',
  rate_limited: 'Too many requests. Try again later.',
  internal_error: 'Something went wrong.',
};

/** Status for each business-rule error. */
const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, number> = {
  invalid_credentials: 401,
  unauthorized: 401,
  email_taken: 409,
};

export const statusForDomainError = (code: DomainErrorCode): number => DOMAIN_ERROR_STATUS[code];

export function sendError(
  res: Response,
  status: number,
  code: HttpErrorCode,
  details?: ErrorDetail[],
): void {
  const body = { error: { code, message: MESSAGES[code], ...(details ? { details } : {}) } };
  res.status(status).json(body);
}
