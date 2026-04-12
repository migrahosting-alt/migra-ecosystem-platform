/**
 * Lightweight TTL cache for inline completion results.
 * Key: `${document.uri.toString()}:${offset}` (character offset in the document).
 * Entries older than TTL_MS are evicted on the next read or explicit `evict()` call.
 */

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const TTL_MS = 2_000;
const MAX_ENTRIES = 200;

export class CompletionCache {
  private readonly store = new Map<string, CacheEntry>();

  get(key: string): string | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: string): void {
    if (this.store.size >= MAX_ENTRIES) {
      // Evict the oldest inserted key (Map iterates in insertion order)
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }

  /** Evict all expired entries. Call periodically to avoid unbounded growth. */
  evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
