/** Points at the offending field and the rule it broke. Never contains the submitted value. */
export type FieldIssue = { path: string; code: string };

/**
 * Business-rule failures raised by services. They carry a code (and, for validation failures that
 * depend on state such as the current time, the offending fields); the HTTP layer decides the
 * status and message, so services stay independent of HTTP.
 */
export type DomainErrorCode =
  | 'invalid_credentials'
  | 'unauthorized'
  | 'email_taken'
  | 'validation_error'
  | 'forbidden'
  | 'not_found'
  | 'user_not_found'
  | 'already_invited'
  | 'invitee_limit_reached'
  | 'invalid_state';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly details?: FieldIssue[],
  ) {
    super(code);
    this.name = 'DomainError';
  }
}
