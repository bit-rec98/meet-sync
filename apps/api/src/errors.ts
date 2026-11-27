/**
 * Business-rule failures raised by services. They carry only a code; the HTTP layer decides the
 * status and message, so services stay independent of HTTP.
 */
export type DomainErrorCode = 'invalid_credentials' | 'unauthorized' | 'email_taken';

export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode) {
    super(code);
    this.name = 'DomainError';
  }
}
