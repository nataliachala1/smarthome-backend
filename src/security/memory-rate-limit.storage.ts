import type { ThrottlerStorage } from '@nestjs/throttler';

interface Counter {
  hits: number;
  expiresAt: number;
  blockedUntil: number;
}

// Fixed windows, bounded memory, no timers and no cross-client expiry state.
// This store is local to one process; a replica deployment needs shared storage.
export class MemoryRateLimitStorage implements ThrottlerStorage {
  private readonly counters = new Map<string, Counter>();
  private nextSweepAt = 0;
  private readonly sweepInterval = 60_000;

  constructor(private readonly maxEntries = 10_000) {}

  increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ReturnType<ThrottlerStorage['increment']> {
    const now = Date.now();
    if (now >= this.nextSweepAt) {
      for (const [storedKey, counter] of this.counters) {
        if (now >= Math.max(counter.expiresAt, counter.blockedUntil)) {
          this.counters.delete(storedKey);
        }
      }
      this.nextSweepAt = now + this.sweepInterval;
    }

    const storageKey = `${throttlerName}:${key}`;
    let counter = this.counters.get(storageKey);
    if (
      counter &&
      ((counter.blockedUntil > 0 && now >= counter.blockedUntil) ||
        (counter.blockedUntil === 0 && now >= counter.expiresAt))
    ) {
      this.counters.delete(storageKey);
      counter = undefined;
    }

    if (!counter) {
      if (this.counters.size >= this.maxEntries) {
        // Do not evict active clients or allow unlimited allocations under load.
        const retryAfter = Math.max(
          1,
          Math.ceil((this.nextSweepAt - now) / 1000),
        );
        return Promise.resolve({
          totalHits: limit + 1,
          timeToExpire: retryAfter,
          isBlocked: true,
          timeToBlockExpire: retryAfter,
        });
      }
      counter = { hits: 0, expiresAt: now + ttl, blockedUntil: 0 };
      this.counters.set(storageKey, counter);
    }

    if (counter.blockedUntil === 0) {
      counter.hits += 1;
      if (counter.hits > limit) counter.blockedUntil = now + blockDuration;
    }

    return Promise.resolve({
      totalHits: counter.hits,
      timeToExpire: Math.max(0, Math.ceil((counter.expiresAt - now) / 1000)),
      isBlocked: counter.blockedUntil > now,
      timeToBlockExpire: Math.max(
        0,
        Math.ceil((counter.blockedUntil - now) / 1000),
      ),
    });
  }
}
