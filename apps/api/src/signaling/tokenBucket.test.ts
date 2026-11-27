import { describe, expect, it } from 'vitest';
import { createTokenBucket } from './tokenBucket.js';

function bucketWithClock(capacity: number, refillPerSecond: number) {
  const clock = { ms: 1_000_000 };
  const bucket = createTokenBucket({ capacity, refillPerSecond, now: () => clock.ms });
  return { bucket, clock };
}

const takeAll = (bucket: { tryTake(): boolean }, attempts: number): number =>
  Array.from({ length: attempts }, () => bucket.tryTake()).filter(Boolean).length;

describe('token bucket', () => {
  it('allows a burst up to its capacity and then refuses', () => {
    const { bucket } = bucketWithClock(5, 1);
    expect(takeAll(bucket, 8)).toBe(5);
  });

  it('refills over time, at the configured rate', () => {
    const { bucket, clock } = bucketWithClock(5, 2); // two tokens per second
    expect(takeAll(bucket, 5)).toBe(5);
    clock.ms += 1000;
    expect(takeAll(bucket, 5)).toBe(2);
    clock.ms += 500;
    expect(takeAll(bucket, 5)).toBe(1);
  });

  it('never holds more than its capacity, however long it was idle', () => {
    const { bucket, clock } = bucketWithClock(3, 10);
    clock.ms += 3_600_000;
    expect(takeAll(bucket, 10)).toBe(3);
  });

  it('keeps a steady sender within the limit and stops a fast one', () => {
    const { bucket, clock } = bucketWithClock(10, 10);
    let accepted = 0;
    for (let step = 0; step < 100; step++) {
      clock.ms += 100; // 10 messages per second: exactly the refill rate
      if (bucket.tryTake()) accepted += 1;
    }
    expect(accepted).toBe(100);

    let refused = 0;
    for (let step = 0; step < 100; step++) {
      clock.ms += 10; // 100 messages per second: ten times the rate
      if (!bucket.tryTake()) refused += 1;
    }
    expect(refused).toBeGreaterThan(70);
  });

  it('is not confused by a clock that goes backwards', () => {
    const { bucket, clock } = bucketWithClock(2, 1);
    expect(takeAll(bucket, 2)).toBe(2);
    clock.ms -= 10_000;
    expect(bucket.tryTake()).toBe(false);
  });
});
