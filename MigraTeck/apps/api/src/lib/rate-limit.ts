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

export function enforceRateLimit({
  key,
  limit,
  windowMs,
}: RateLimitOptions): { allowed: boolean; resetAt: number } {
  const now = Date.now();
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
    };
  }

  current.count += 1;

  return {
    allowed: current.count <= limit,
    resetAt: current.resetAt,
  };
}
