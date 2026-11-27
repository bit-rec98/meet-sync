import { describe, expect, it } from 'vitest';
import { createTicketStore } from './tickets.js';

const DATA = { userId: 'user-1', displayName: 'Ana', meetingId: 'meeting-1' };

function setup(ttlSeconds?: number) {
  const clock = { current: new Date('2026-12-01T12:00:00.000Z') };
  const store = createTicketStore({
    now: () => clock.current,
    ...(ttlSeconds ? { ttlSeconds } : {}),
  });
  const advance = (ms: number) => (clock.current = new Date(clock.current.getTime() + ms));
  return { store, advance };
}

describe('ticket store', () => {
  it('issues a random-looking ticket and says how long it lasts', () => {
    const { store } = setup();
    const { ticket, expiresInSeconds } = store.issue(DATA);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresInSeconds).toBe(30);
    expect(store.issue(DATA).ticket).not.toBe(ticket);
  });

  it('redeems a ticket for exactly what it was issued for', () => {
    const { store } = setup();
    const { ticket } = store.issue(DATA);
    expect(store.consume(ticket)).toEqual(DATA);
  });

  it('works only once', () => {
    const { store } = setup();
    const { ticket } = store.issue(DATA);
    expect(store.consume(ticket)).not.toBeNull();
    expect(store.consume(ticket)).toBeNull();
  });

  it('expires after 30 seconds: valid just before, refused at the limit', () => {
    const first = setup();
    const { ticket: justInTime } = first.store.issue(DATA);
    first.advance(29_999);
    expect(first.store.consume(justInTime)).toEqual(DATA);

    const second = setup();
    const { ticket: late } = second.store.issue(DATA);
    second.advance(30_000);
    expect(second.store.consume(late)).toBeNull();
  });

  it('uses up an expired ticket too, so it cannot be retried', () => {
    const { store, advance } = setup();
    const { ticket } = store.issue(DATA);
    advance(60_000);
    expect(store.consume(ticket)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it('refuses unknown, malformed, empty and oversized tickets without looking anything up', () => {
    const { store } = setup();
    store.issue(DATA);
    for (const bad of [
      '',
      'x',
      'a'.repeat(43),
      'a'.repeat(44),
      `${'a'.repeat(42)}!`,
      "' OR 1=1 --",
      'a'.repeat(10_000),
    ]) {
      expect(store.consume(bad), bad.slice(0, 20)).toBeNull();
    }
    expect(store.size()).toBe(1);
  });

  it('keeps each ticket tied to its own user and meeting', () => {
    const { store } = setup();
    const a = store.issue({ userId: 'a', displayName: 'A', meetingId: 'm1' });
    const b = store.issue({ userId: 'b', displayName: 'B', meetingId: 'm2' });
    expect(store.consume(b.ticket)).toMatchObject({ userId: 'b', meetingId: 'm2' });
    expect(store.consume(a.ticket)).toMatchObject({ userId: 'a', meetingId: 'm1' });
  });

  it('does not keep the issued data alive through the caller’s object', () => {
    const { store } = setup();
    const data = { ...DATA };
    const { ticket } = store.issue(data);
    data.userId = 'someone-else';
    expect(store.consume(ticket)?.userId).toBe('user-1');
  });

  it('forgets expired tickets, so memory does not grow', () => {
    const { store, advance } = setup();
    for (let index = 0; index < 50; index++) store.issue(DATA);
    expect(store.size()).toBe(50);
    advance(31_000);
    store.issue(DATA); // issuing sweeps the old ones
    expect(store.size()).toBe(1);
  });
});
