```typescript
export function parseRetryAfter(value: string | null | undefined, now: Date, maxMs: number): number | undefined {
  if (!value) {
    return undefined;
  }

  let delayMs: number;

  // Try parsing as a delay in seconds
  const delaySeconds = parseInt(value, 10);
  if (!isNaN(delaySeconds)) {
    delayMs = delaySeconds * 1000;
    if (delayMs < 0) {
      return undefined;
    }
    return Math.min(delayMs, maxMs);
  }

  // Try parsing as an HTTP-date
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return undefined;
  }
  delayMs = date.getTime() - now.getTime();
  if (delayMs <= 0) {
    return undefined;
  }
  return Math.min(delayMs, maxMs);
}
```