import type { en } from '../i18n/locales/en';
import type { FieldProblem, FormField } from './validation';

/** A message for the whole form (a key of the `errors` texts). */
export type ErrorTextKey = keyof typeof en.errors;

/**
 * What to tell the user about a failed form submission: a message for the whole form, and/or
 * messages for specific fields. Expressed as translation keys, so it does not depend on the language.
 */
export type FormFailure = {
  form?: ErrorTextKey;
  fields?: Partial<Record<FormField, FieldProblem>>;
};
