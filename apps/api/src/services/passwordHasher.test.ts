import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwordHasher.js';

describe('password hashing', () => {
  it('produces an Argon2id PHC string with the documented parameters', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  });

  it('never contains the password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse');
  });

  it('uses a different salt each time', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same-password-1'),
      hashPassword('same-password-1'),
    ]);
    expect(first).not.toBe(second);
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('handles non-ASCII passwords', async () => {
    const hash = await hashPassword('contraseña-segura-ñandú-🔐');
    expect(await verifyPassword('contraseña-segura-ñandú-🔐', hash)).toBe(true);
    expect(await verifyPassword('contrasena-segura-nandu-🔐', hash)).toBe(false);
  });

  it('returns false for malformed stored hashes instead of throwing', async () => {
    for (const bad of [
      '',
      'plaintext',
      '$argon2id$garbage',
      '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaA',
    ]) {
      expect(await verifyPassword('whatever-password', bad)).toBe(false);
    }
  });

  it('refuses stored parameters outside the allowed bounds', async () => {
    const salt = 'c2FsdHNhbHRzYWx0';
    const key = 'aGFzaGhhc2hoYXNoaGFzaA';
    for (const cost of [
      'm=4294967295,t=2,p=1',
      'm=19456,t=999999,p=1',
      'm=19456,t=2,p=99',
      'm=19456,t=0,p=1',
    ]) {
      expect(
        await verifyPassword('whatever-password', `$argon2id$v=19$${cost}$${salt}$${key}`),
      ).toBe(false);
    }
  });
});
