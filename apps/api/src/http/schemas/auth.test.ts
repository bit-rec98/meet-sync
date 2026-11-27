import { describe, expect, it } from 'vitest';
import { HttpError } from '../errorResponse.js';
import { parseBody } from '../validation.js';
import { loginBodySchema, registerBodySchema } from './auth.js';

const valid = { email: 'ana@example.test', displayName: 'Ana', password: 'a'.repeat(12) };

function failureOf(schema: Parameters<typeof parseBody>[0], body: unknown): HttpError {
  try {
    parseBody(schema, body);
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('Expected validation to fail');
}

describe('registerBodySchema', () => {
  it('accepts a valid body', () => {
    expect(parseBody(registerBodySchema, valid)).toEqual(valid);
  });

  it('normalizes the email (trim, lower-case) and trims the display name', () => {
    const parsed = parseBody(registerBodySchema, {
      ...valid,
      email: '  Ana@Example.TEST ',
      displayName: '  Ana  ',
    });
    expect(parsed.email).toBe('ana@example.test');
    expect(parsed.displayName).toBe('Ana');
  });

  it('does not alter the password', () => {
    const password = '  spaces are allowed  ';
    expect(parseBody(registerBodySchema, { ...valid, password }).password).toBe(password);
  });

  it('enforces the password length: 11 rejected, 12 and 128 accepted, 129 rejected', () => {
    expect(failureOf(registerBodySchema, { ...valid, password: 'a'.repeat(11) }).details).toEqual([
      { path: 'password', code: 'too_small' },
    ]);
    expect(() =>
      parseBody(registerBodySchema, { ...valid, password: 'a'.repeat(12) }),
    ).not.toThrow();
    expect(() =>
      parseBody(registerBodySchema, { ...valid, password: 'a'.repeat(128) }),
    ).not.toThrow();
    expect(failureOf(registerBodySchema, { ...valid, password: 'a'.repeat(129) }).details).toEqual([
      { path: 'password', code: 'too_big' },
    ]);
  });

  it('rejects invalid emails', () => {
    for (const email of [
      '',
      'plain',
      'a@',
      '@example.test',
      'a b@example.test',
      `${'a'.repeat(250)}@example.test`,
    ]) {
      expect(failureOf(registerBodySchema, { ...valid, email }).details?.[0]?.path).toBe('email');
    }
  });

  it('enforces the display name: 1-60 characters, no control characters', () => {
    for (const displayName of [
      '',
      '   ',
      'a'.repeat(61),
      'line\nbreak',
      'tab\there',
      'nul\u0000',
    ]) {
      expect(failureOf(registerBodySchema, { ...valid, displayName }).details?.[0]?.path).toBe(
        'displayName',
      );
    }
    expect(() =>
      parseBody(registerBodySchema, { ...valid, displayName: 'a'.repeat(60) }),
    ).not.toThrow();
    expect(() =>
      parseBody(registerBodySchema, { ...valid, displayName: 'José Núñez 🙂' }),
    ).not.toThrow();
  });

  it('rejects missing fields and wrong types', () => {
    expect(
      failureOf(registerBodySchema, {})
        .details?.map((d) => d.path)
        .sort(),
    ).toEqual(['displayName', 'email', 'password']);
    expect(
      failureOf(registerBodySchema, { ...valid, password: 123456789012 }).details?.[0],
    ).toEqual({
      path: 'password',
      code: 'invalid_type',
    });
    for (const body of [null, undefined, 'text', 42, [], [valid]]) {
      expect(failureOf(registerBodySchema, body).status).toBe(400);
    }
  });

  it('rejects unknown fields and reports only their names', () => {
    const error = failureOf(registerBodySchema, { ...valid, role: 'admin' });
    expect(error.details).toEqual([{ path: 'role', code: 'unrecognized_key' }]);
  });

  it('never includes submitted values in the error details', () => {
    const error = failureOf(registerBodySchema, { ...valid, email: 'not-an-email-secret-value' });
    expect(JSON.stringify(error.details)).not.toContain('secret-value');
  });
});

describe('loginBodySchema', () => {
  it('accepts any non-empty password up to 128 characters, even a short one', () => {
    expect(() =>
      parseBody(loginBodySchema, { email: 'ana@example.test', password: 'x' }),
    ).not.toThrow();
    expect(() =>
      parseBody(loginBodySchema, { email: 'ana@example.test', password: 'x'.repeat(128) }),
    ).not.toThrow();
  });

  it('rejects an empty or oversized password', () => {
    expect(
      failureOf(loginBodySchema, { email: 'ana@example.test', password: '' }).details?.[0]?.path,
    ).toBe('password');
    expect(
      failureOf(loginBodySchema, { email: 'ana@example.test', password: 'x'.repeat(129) })
        .details?.[0]?.path,
    ).toBe('password');
  });

  it('normalizes the email and rejects extra fields', () => {
    expect(parseBody(loginBodySchema, { email: ' ANA@example.test ', password: 'x' }).email).toBe(
      'ana@example.test',
    );
    expect(
      failureOf(loginBodySchema, { email: 'ana@example.test', password: 'x', displayName: 'Ana' })
        .details,
    ).toEqual([{ path: 'displayName', code: 'unrecognized_key' }]);
  });
});
