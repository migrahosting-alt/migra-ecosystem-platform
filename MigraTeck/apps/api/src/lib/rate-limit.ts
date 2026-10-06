type RateLimitState = {
  count: number;
  resetAt: number;
};

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

const store = new Map<string, RateLimitState>();
let operationsSinceSweep = 0;

function sweepExpired(now: number): void {
  operationsSinceSweep += 1;
  if (operationsSinceSweep < 1024 && store.size < 50_000) return;

  operationsSinceSweep = 0;
  for (const [key, state] of store.entries()) {
    if (state.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function enforceRateLimit({
  key,
  limit,
  windowMs,
}: RateLimitOptions): {
  allowed: boolean;
  resetAt: number;
  remaining: number;
  limit: number;
} {
  const now = Date.now();
  sweepExpired(now);
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, {
      count: 1,
      resetAt,
    });

    return {
      allowed: true,
      resetAt,
      remaining: Math.max(0, limit - 1),
      limit,
    };
  }

  current.count += 1;

  return {
    allowed: current.count <= limit,
    resetAt: current.resetAt,
    remaining: Math.max(0, limit - current.count),
    limit,
  };
}
