import { ApiError } from '../api/errors';
import type { en } from '../i18n/locales/en';
import { problemFromIssue, type FieldProblem, type FormField } from '../forms/validation';

export type ErrorTextKey = keyof typeof en.errors;

/**
 * What to tell the user about a failed login or registration: a message for the whole form, and/or
 * messages for specific fields. Expressed as translation keys, so it does not depend on the language.
 */
export type FormFailure = {
  form?: ErrorTextKey;
  fields?: Partial<Record<FormField, FieldProblem>>;
};

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
