import { describe, expect, it } from 'vitest';
import type { SignalingConfig } from '../config/env.js';
import { buildIceServers, turnCredentials } from './iceServers.js';

// 2026-12-01T12:00:00Z
const NOW = new Date('2026-12-01T12:00:00.000Z');

describe('turnCredentials', () => {
  it('matches values computed independently with another implementation (Python hmac)', () => {
    // 1893456000 = 2030-01-01T00:00:00Z; the clock below is chosen so the expiry lands exactly there.
    const now = new Date((1893456000 - 3600) * 1000);
    expect(turnCredentials('secret', 'user-1', now)).toEqual({
      username: '1893456000:user-1',
      credential: 'wQNffiWjgU7hJjoREK4fjRq8tz0=',
    });
    expect(
      turnCredentials(
        's'.repeat(40),
        '3f0e4b1c-6a52-4a67-9d5e-1f2a3b4c5d6e',
        new Date((1700000000 - 3600) * 1000),
      ),
    ).toEqual({
      username: '1700000000:3f0e4b1c-6a52-4a67-9d5e-1f2a3b4c5d6e',
      credential: 'rYB5qHtbQXXhKh+DKyktqTEIwvM=',
    });
  });

  it('expires one hour after it is issued, by default', () => {
    const { username } = turnCredentials('s'.repeat(40), 'u', NOW);
    expect(Number(username.split(':')[0])).toBe(Math.floor(NOW.getTime() / 1000) + 3600);
  });

  it('gives different users, times and secrets different credentials', () => {
    const base = turnCredentials('s'.repeat(40), 'user-a', NOW).credential;
    expect(turnCredentials('s'.repeat(40), 'user-b', NOW).credential).not.toBe(base);
    expect(
      turnCredentials('s'.repeat(40), 'user-a', new Date(NOW.getTime() + 5000)).credential,
    ).not.toBe(base);
    expect(turnCredentials('t'.repeat(40), 'user-a', NOW).credential).not.toBe(base);
  });

  it('never contains the shared secret', () => {
    const secret = 'super-secret-shared-value-1234567890-abc';
    const { username, credential } = turnCredentials(secret, 'u', NOW);
    expect(username + credential).not.toContain(secret);
  });
});

describe('buildIceServers', () => {
  const config = (overrides: Partial<SignalingConfig> = {}): SignalingConfig => ({
    maxParticipants: { audio: 10, video: 4 },
    stunUrls: ['stun:stun.example:3478'],
    turn: null,
    ...overrides,
  });

  it('lists STUN servers only, with no credentials, when there is no TURN server', () => {
    expect(buildIceServers(config(), 'u', NOW)).toEqual([{ urls: ['stun:stun.example:3478'] }]);
  });

  it('adds TURN with credentials made for the user when configured', () => {
    const servers = buildIceServers(
      config({ turn: { urls: ['turn:relay.example:3478'], sharedSecret: 's'.repeat(40) } }),
      'user-1',
      NOW,
    );
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({ urls: ['stun:stun.example:3478'] });
    expect(servers[1]).toMatchObject({ urls: ['turn:relay.example:3478'] });
    expect(servers[1]?.username).toMatch(/^\d+:user-1$/);
    expect(servers[1]?.credential).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(JSON.stringify(servers)).not.toContain('s'.repeat(40));
  });

  it('can have no STUN servers at all', () => {
    expect(buildIceServers(config({ stunUrls: [] }), 'u', NOW)).toEqual([]);
  });

  it('does not share its configuration arrays with the caller', () => {
    const settings = config();
    const servers = buildIceServers(settings, 'u', NOW);
    servers[0]?.urls.push('stun:evil.example:3478');
    expect(settings.stunUrls).toEqual(['stun:stun.example:3478']);
  });
});
