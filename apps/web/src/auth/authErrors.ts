import { ApiError } from '../api/errors';
import type { FormFailure } from '../forms/failure';
import { problemFromIssue, type FieldProblem, type FormField } from '../forms/validation';

/** What to tell the user about a failed login or registration. */
export function describeFailure(error: unknown): FormFailure {
  if (!(error instanceof ApiError)) return { form: 'unexpected' };

  switch (error.code) {
    case 'invalid_credentials':
      return { form: 'invalidCredentials' };
    case 'email_taken':
      return { fields: { email: { key: 'emailTaken' } } };
    case 'rate_limited':
      return { form: 'rateLimited' };
    case 'network_error':
      return { form: 'network' };
    case 'validation_error': {
      const fields: Partial<Record<FormField, FieldProblem>> = {};
      for (const issue of error.details) {
        const mapped = problemFromIssue(issue);
        if (mapped && !fields[mapped.field]) fields[mapped.field] = mapped.problem;
      }
      return Object.keys(fields).length > 0 ? { fields } : { form: 'validation' };
    }
    default:
      return { form: 'unexpected' };
  }
}
