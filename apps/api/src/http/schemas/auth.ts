import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Trimmed, lower-cased, valid format, at most 254 characters. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Trimmed, 1-60 characters, no control characters (newlines, tabs, NUL...). */
const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^\p{Cc}]*$/u);

// Strict objects: unknown fields are rejected instead of silently ignored.

export const registerBodySchema = z.strictObject({
  email: emailSchema,
  displayName: displayNameSchema,
  // Never trimmed or altered: spaces are valid password characters.
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

// Login accepts any password up to the maximum length: the length policy applies when choosing a
// password, and the cap only bounds how much input is hashed.
export const loginBodySchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export type RegisterBody = z.output<typeof registerBodySchema>;
export type LoginBody = z.output<typeof loginBodySchema>;
