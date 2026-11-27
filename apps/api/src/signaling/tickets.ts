import { createHash, randomBytes } from 'node:crypto';
import { TICKET_TTL_SECONDS } from '@meet-sync/signaling-protocol';

/** What a ticket proves: this user may open a signaling connection for this meeting. */
export type TicketData = { userId: string; displayName: string; meetingId: string };

export type TicketStore = {
  /** Creates a ticket for the connection. Hand the returned value to the client; it is not stored. */
  issue(data: TicketData): { ticket: string; expiresInSeconds: number };
  /**
   * Redeems a ticket. Returns what it proves, or null if it is unknown, malformed, expired or
   * already used. A ticket works exactly once.
   */
  consume(ticket: string): TicketData | null;
  /** Number of tickets that have been issued and not used or expired yet. */
  size(): number;
};

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

/** Only a hash of the ticket is kept, so memory contents do not reveal usable tickets. */
const keyOf = (ticket: string): string => createHash('sha256').update(ticket).digest('hex');

/**
 * Tickets live in memory, which is correct for the single API process this project runs
 * (ADR-001): they last 30 seconds and a restart only means clients ask for a new one.
 */
export function createTicketStore(options: { now: () => Date; ttlSeconds?: number }): TicketStore {
  const ttlMs = (options.ttlSeconds ?? TICKET_TTL_SECONDS) * 1000;
  // Every ticket lives the same time, so insertion order is also expiry order.
  const tickets = new Map<string, { data: TicketData; expiresAt: number }>();

  function dropExpired(): void {
    const current = options.now().getTime();
    for (const [key, entry] of tickets) {
      if (entry.expiresAt > current) break;
      tickets.delete(key);
    }
  }

  return {
    issue(data) {
      dropExpired();
      const ticket = randomBytes(32).toString('base64url');
      tickets.set(keyOf(ticket), { data: { ...data }, expiresAt: options.now().getTime() + ttlMs });
      return { ticket, expiresInSeconds: ttlMs / 1000 };
    },

    consume(ticket) {
      if (!TICKET_PATTERN.test(ticket)) return null;
      const key = keyOf(ticket);
      const entry = tickets.get(key);
      if (!entry) return null;
      tickets.delete(key); // single use, even if it turns out to be expired
      return entry.expiresAt > options.now().getTime() ? entry.data : null;
    },

    size() {
      dropExpired();
      return tickets.size;
    },
  };
}
