import { describe, expect, it } from 'vitest';
import {
  problemFromIssue,
  validateDisplayName,
  validateEmail,
  validateExistingPassword,
  validateNewPassword,
} from './validation';

describe('validateEmail', () => {
  it('accepts ordinary addresses, ignoring surrounding spaces', () => {
    for (const email of ['ana@example.com', '  ana@example.com ', 'a.b+tag@sub.example.org']) {
      expect(validateEmail(email), email).toBeNull();
    }
  });

  it('asks for an address when empty or blank', () => {
    expect(validateEmail('')).toEqual({ key: 'emailRequired' });
    expect(validateEmail('   ')).toEqual({ key: 'emailRequired' });
  });

  it('rejects text that is not an address', () => {
    for (const email of [
      'plain',
      'a@',
      '@example.com',
      'a@b',
      'a b@example.com',
      `${'a'.repeat(250)}@example.com`,
    ]) {
      expect(validateEmail(email), email).toEqual({ key: 'emailInvalid' });
    }
  });
});

describe('validateNewPassword', () => {
  it('enforces 12 to 128 characters', () => {
    expect(validateNewPassword('')).toEqual({ key: 'passwordRequired' });
    expect(validateNewPassword('a'.repeat(11))).toEqual({
      key: 'passwordTooShort',
      values: { min: 12 },
    });
    expect(validateNewPassword('a'.repeat(12))).toBeNull();
    expect(validateNewPassword('a'.repeat(128))).toBeNull();
    expect(validateNewPassword('a'.repeat(129))).toEqual({
      key: 'passwordTooLong',
      values: { max: 128 },
    });
  });

  it('does not trim: spaces count as characters', () => {
    expect(validateNewPassword(' '.repeat(12))).toBeNull();
  });
});

describe('validateExistingPassword', () => {
  it('does not re-apply the length policy when logging in', () => {
    expect(validateExistingPassword('x')).toBeNull();
    expect(validateExistingPassword('')).toEqual({ key: 'passwordRequired' });
    expect(validateExistingPassword('x'.repeat(129))).toEqual({
      key: 'passwordTooLong',
      values: { max: 128 },
    });
  });
});

describe('validateDisplayName', () => {
  it('accepts 1 to 60 characters after trimming, including accents and emoji', () => {
    for (const name of ['A', '  Ana  ', 'José Núñez 🙂', 'a'.repeat(60)]) {
      expect(validateDisplayName(name), name).toBeNull();
    }
  });

  it('rejects blank, too long, and control characters', () => {
    expect(validateDisplayName('   ')).toEqual({ key: 'displayNameRequired' });
    expect(validateDisplayName('a'.repeat(61))).toEqual({
      key: 'displayNameTooLong',
      values: { max: 60 },
    });
    expect(validateDisplayName('line\nbreak')).toEqual({ key: 'displayNameInvalid' });
    expect(validateDisplayName('nul\u0000')).toEqual({ key: 'displayNameInvalid' });
  });
});

describe('problemFromIssue', () => {
  it('maps the API’s field issues to the same messages', () => {
    expect(problemFromIssue({ path: 'email', code: 'invalid_format' })).toEqual({
      field: 'email',
      problem: { key: 'emailInvalid' },
    });
    expect(problemFromIssue({ path: 'password', code: 'too_small' })).toEqual({
      field: 'password',
      problem: { key: 'passwordTooShort', values: { min: 12 } },
    });
    expect(problemFromIssue({ path: 'displayName', code: 'too_big' })).toEqual({
      field: 'displayName',
      problem: { key: 'displayNameTooLong', values: { max: 60 } },
    });
  });

  it('ignores issues about fields the form does not have', () => {
    expect(problemFromIssue({ path: 'role', code: 'unrecognized_key' })).toBeNull();
    expect(problemFromIssue({ path: '', code: 'custom' })).toBeNull();
  });
});
