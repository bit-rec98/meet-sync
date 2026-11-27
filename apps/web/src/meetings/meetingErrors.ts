import { ApiError } from '../api/errors';
import type { ErrorTextKey, FormFailure } from '../forms/failure';
import type { FieldProblem, FormField } from '../forms/validation';
import { problemFromMeetingIssue } from './meetingValidation';

/**
 * What to tell the user when an action on a meeting (a form, a button) failed: messages for the
 * whole action and/or for specific fields. Used by the meeting form and the invitation form.
 */
export function describeMeetingFailure(error: unknown): FormFailure {
  if (!(error instanceof ApiError)) return { form: 'unexpected' };

  switch (error.code) {
    case 'validation_error': {
      const fields: Partial<Record<FormField, FieldProblem>> = {};
      for (const issue of error.details) {
        const mapped = problemFromMeetingIssue(issue);
        if (mapped && !fields[mapped.field]) fields[mapped.field] = mapped.problem;
      }
      return Object.keys(fields).length > 0 ? { fields } : { form: 'validation' };
    }
    case 'user_not_found':
      return { fields: { email: { key: 'userNotFound' } } };
    case 'already_invited':
      return { fields: { email: { key: 'alreadyInvited' } } };
    case 'invitee_limit_reached':
      return { form: 'inviteeLimit' };
    case 'invalid_state':
      return { form: 'invalidState' };
    case 'forbidden':
      return { form: 'forbidden' };
    case 'not_found':
      return { form: 'notFound' };
    case 'rate_limited':
      return { form: 'rateLimited' };
    case 'network_error':
      return { form: 'network' };
    default:
      return { form: 'unexpected' };
  }
}

/** The message for a button action (cancel, leave, remove) that failed. */
export function describeActionFailure(error: unknown): ErrorTextKey {
  return describeMeetingFailure(error).form ?? 'unexpected';
}

/** The message for a page that could not load its data. */
export function describeLoadFailure(error: unknown): ErrorTextKey {
  if (error instanceof ApiError) {
    if (error.code === 'not_found') return 'notFound';
    if (error.code === 'network_error') return 'network';
    if (error.code === 'rate_limited') return 'rateLimited';
  }
  return 'loadFailed';
}
