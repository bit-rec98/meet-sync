import type { FieldIssue } from '../api/types';
import type { en } from '../i18n/locales/en';

// Same limits as the API. The server remains the authority; these checks only give instant feedback.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_DISPLAY_NAME_LENGTH = 60;
const MAX_EMAIL_LENGTH = 254;

export type ValidationKey = keyof typeof en.validation;

/** A problem with one field, as a translation key plus the numbers its text needs. */
export type FieldProblem = { key: ValidationKey; values?: { min?: number; max?: number } };

/** Every field of every form, so the shared form logic can point at the right input. */
export type FormField =
  | 'email'
  | 'password'
  | 'displayName'
  | 'title'
  | 'description'
  | 'startsAt'
  | 'durationMinutes'
  | 'callType';

// Deliberately lenient: something@something.tld without spaces. The server checks properly.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTER = /\p{Cc}/u;

export function validateEmail(value: string): FieldProblem | null {
  const email = value.trim();
  if (email === '') return { key: 'emailRequired' };
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email)) return { key: 'emailInvalid' };
  return null;
}

/** For creating an account: the length policy applies. Passwords are never trimmed. */
export function validateNewPassword(value: string): FieldProblem | null {
  if (value === '') return { key: 'passwordRequired' };
  if (value.length < MIN_PASSWORD_LENGTH) {
    return { key: 'passwordTooShort', values: { min: MIN_PASSWORD_LENGTH } };
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return { key: 'passwordTooLong', values: { max: MAX_PASSWORD_LENGTH } };
  }
  return null;
}

/** For logging in: the policy is not re-explained, only emptiness and the hard maximum. */
export function validateExistingPassword(value: string): FieldProblem | null {
  if (value === '') return { key: 'passwordRequired' };
  if (value.length > MAX_PASSWORD_LENGTH) {
    return { key: 'passwordTooLong', values: { max: MAX_PASSWORD_LENGTH } };
  }
  return null;
}

export function validateDisplayName(value: string): FieldProblem | null {
  const name = value.trim();
  if (name === '') return { key: 'displayNameRequired' };
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    return { key: 'displayNameTooLong', values: { max: MAX_DISPLAY_NAME_LENGTH } };
  }
  if (CONTROL_CHARACTER.test(name)) return { key: 'displayNameInvalid' };
  return null;
}

const FORM_FIELDS: readonly string[] = ['email', 'password', 'displayName'];

/**
 * Turns a field issue reported by the API into a message for that field, for the cases the
 * browser checks could not catch. Returns null for issues that have no specific message.
 */
export function problemFromIssue(
  issue: FieldIssue,
): { field: FormField; problem: FieldProblem } | null {
  if (!FORM_FIELDS.includes(issue.path)) return null;
  const field = issue.path as FormField;

  if (field === 'email') return { field, problem: { key: 'emailInvalid' } };
  if (field === 'password') {
    if (issue.code === 'too_small') {
      return { field, problem: { key: 'passwordTooShort', values: { min: MIN_PASSWORD_LENGTH } } };
    }
    if (issue.code === 'too_big') {
      return { field, problem: { key: 'passwordTooLong', values: { max: MAX_PASSWORD_LENGTH } } };
    }
    return null;
  }
  if (issue.code === 'too_small') return { field, problem: { key: 'displayNameRequired' } };
  if (issue.code === 'too_big') {
    return {
      field,
      problem: { key: 'displayNameTooLong', values: { max: MAX_DISPLAY_NAME_LENGTH } },
    };
  }
  return { field, problem: { key: 'displayNameInvalid' } };
}
