```typescript
export function parseRetryAfter(value: string | null | undefined, now: Date, maxMs: number): number | undefined {
  if (value == null || value.trim() === '') return undefined;

  const delaySeconds = parseInt(value, 10);
  if (!isNaN(delaySeconds)) {
    const delayMs = delaySeconds * 1000;
    return Math.max(0, Math.min(delayMs, maxMs));
  }

  const date = new Date(value);
  if (date.toString() === 'Invalid Date' || date <= now) return undefined;

  const retryAfterMs = date.getTime() - now.getTime();
  return Math.max(0, Math.min(retryAfterMs, maxMs));
}
```