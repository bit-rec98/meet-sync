import type { CallType, Meeting, MeetingChanges, MeetingInput } from '../api/meetingsApi';
import type { FieldIssue } from '../api/types';
import type { FieldProblem, FormField } from '../forms/validation';
import { fromLocalInputValue, toLocalInputValue } from './time';

// Same limits as the API. The server remains the authority; these checks only give instant feedback.
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 480;
const MAX_DAYS_AHEAD = 365;
const CLOCK_SKEW_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The meeting form as the user fills it in: everything is text until validated. */
export type MeetingFormValues = {
  title: string;
  description: string;
  /** The value of a datetime-local input: local time, no zone. */
  startsAt: string;
  durationMinutes: string;
  callType: CallType;
};

export function validateTitle(value: string): FieldProblem | null {
  const title = value.trim();
  if (title === '') return { key: 'titleRequired' };
  if (title.length > MAX_TITLE_LENGTH) {
    return { key: 'titleTooLong', values: { max: MAX_TITLE_LENGTH } };
  }
  return null;
}

export function validateDescription(value: string): FieldProblem | null {
  if (value.trim().length > MAX_DESCRIPTION_LENGTH) {
    return { key: 'descriptionTooLong', values: { max: MAX_DESCRIPTION_LENGTH } };
  }
  return null;
}

/** The start must be a real date and time, not in the past (a minute of tolerance) and within a year. */
export function validateStartsAt(value: string, now: Date): FieldProblem | null {
  if (value.trim() === '') return { key: 'startsAtRequired' };
  const iso = fromLocalInputValue(value.trim());
  if (iso === null) return { key: 'startsAtInvalid' };
  const startsAt = new Date(iso).getTime();
  if (startsAt < now.getTime() - CLOCK_SKEW_MS) return { key: 'startsAtPast' };
  if (startsAt > now.getTime() + MAX_DAYS_AHEAD * DAY_MS) return { key: 'startsAtTooFar' };
  return null;
}

export function validateDuration(value: string): FieldProblem | null {
  const text = value.trim();
  const minutes = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_DURATION_MINUTES ||
    minutes > MAX_DURATION_MINUTES
  ) {
    return {
      key: 'durationInvalid',
      values: { min: MIN_DURATION_MINUTES, max: MAX_DURATION_MINUTES },
    };
  }
  return null;
}

/** Fills the form from a saved meeting; the start time is shown in the user's own time zone. */
export function valuesFromMeeting(meeting: Meeting): MeetingFormValues {
  return {
    title: meeting.title,
    description: meeting.description ?? '',
    startsAt: toLocalInputValue(meeting.startsAt),
    durationMinutes: String(meeting.durationMinutes),
    callType: meeting.callType,
  };
}

/** Converts values that passed validation to what the API expects. */
export function toMeetingInput(values: MeetingFormValues): MeetingInput {
  const startsAt = fromLocalInputValue(values.startsAt.trim());
  if (startsAt === null) throw new Error('toMeetingInput needs validated values');
  const description = values.description.trim();
  return {
    title: values.title.trim(),
    description: description === '' ? null : description,
    startsAt,
    durationMinutes: Number(values.durationMinutes.trim()),
    callType: values.callType,
  };
}

/** Only the fields that differ from the saved meeting, so an edit changes nothing else. */
export function changesBetween(original: Meeting, input: MeetingInput): MeetingChanges {
  const changes: MeetingChanges = {};
  if (input.title !== original.title) changes.title = input.title;
  if (input.description !== original.description) changes.description = input.description;
  if (new Date(input.startsAt).getTime() !== new Date(original.startsAt).getTime()) {
    changes.startsAt = input.startsAt;
  }
  if (input.durationMinutes !== original.durationMinutes) {
    changes.durationMinutes = input.durationMinutes;
  }
  if (input.callType !== original.callType) changes.callType = input.callType;
  return changes;
}

/** Turns a field issue reported by the API into a message for that field of the meeting form. */
export function problemFromMeetingIssue(
  issue: FieldIssue,
): { field: FormField; problem: FieldProblem } | null {
  switch (issue.path) {
    case 'title':
      return issue.code === 'too_big'
        ? { field: 'title', problem: { key: 'titleTooLong', values: { max: MAX_TITLE_LENGTH } } }
        : { field: 'title', problem: { key: 'titleRequired' } };
    case 'description':
      return {
        field: 'description',
        problem: { key: 'descriptionTooLong', values: { max: MAX_DESCRIPTION_LENGTH } },
      };
    case 'startsAt':
      if (issue.code === 'in_the_past')
        return { field: 'startsAt', problem: { key: 'startsAtPast' } };
      if (issue.code === 'too_far_ahead') {
        return { field: 'startsAt', problem: { key: 'startsAtTooFar' } };
      }
      return { field: 'startsAt', problem: { key: 'startsAtInvalid' } };
    case 'durationMinutes':
      return {
        field: 'durationMinutes',
        problem: {
          key: 'durationInvalid',
          values: { min: MIN_DURATION_MINUTES, max: MAX_DURATION_MINUTES },
        },
      };
    default:
      return null;
  }
}
