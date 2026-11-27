import { z } from 'zod';
import { emailSchema } from './auth.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
const MAX_OFFSET = 1_000_000; // keeps deep paging from becoming an expensive scan

const titleSchema = z.string().trim().min(1).max(120);

/** Trimmed, at most 2000 characters; an empty text is stored as no description. */
const descriptionSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((value) => (value === '' ? null : value));

/** ISO 8601 with a `Z` or an explicit offset (local times without offset are rejected), as a Date. */
const startsAtSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const durationMinutesSchema = z.number().int().min(5).max(480);
const callTypeSchema = z.enum(['audio', 'video']);
const uuidSchema = z.uuid();

// Strict objects: unknown fields are rejected instead of silently ignored.

export const createMeetingBodySchema = z.strictObject({
  title: titleSchema,
  description: descriptionSchema.optional().transform((value) => value ?? null),
  startsAt: startsAtSchema,
  durationMinutes: durationMinutesSchema,
  callType: callTypeSchema,
});

/** Any subset of the creation fields. An absent description means "unchanged", null clears it. */
export const updateMeetingBodySchema = z
  .strictObject({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    startsAt: startsAtSchema.optional(),
    durationMinutes: durationMinutesSchema.optional(),
    callType: callTypeSchema.optional(),
  })
  .refine((changes) => Object.values(changes).some((value) => value !== undefined));

export const addInviteeBodySchema = z.strictObject({ email: emailSchema });

export const meetingParamsSchema = z.strictObject({ id: uuidSchema });
export const inviteeParamsSchema = z.strictObject({ id: uuidSchema, userId: uuidSchema });

export const listMeetingsQuerySchema = z.strictObject({
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
});
