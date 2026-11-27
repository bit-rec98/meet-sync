export type TokenBucket = {
  /** Takes one token if there is one. Returns false when the sender is going too fast. */
  tryTake(): boolean;
};

/**
 * Limits a rate while allowing short bursts: it holds up to `capacity` tokens, refilled at
 * `refillPerSecond`. Connecting two peers sends a burst of candidates, then traffic is calm.
 */
export function createTokenBucket(options: {
  capacity: number;
  refillPerSecond: number;
  now: () => number;
}): TokenBucket {
  let tokens = options.capacity;
  let lastRefill = options.now();

  return {
    tryTake() {
      const current = options.now();
      const elapsedSeconds = Math.max(0, current - lastRefill) / 1000;
      tokens = Math.min(options.capacity, tokens + elapsedSeconds * options.refillPerSecond);
      lastRefill = current;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
