const SENSITIVE_KEY = /(secret|token|password|api[-_]?key|authorization|cookie|signature|private|mfa)/i;

export function sanitize<T = unknown>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item)) as T;
  }
  if (typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(inner);
  }
  return output as T;
}

export function sanitizeLogLine(line: string): string {
  return line.replace(/(secret|token|password|api[-_]?key|authorization|cookie|signature)\s*[:=]\s*([^\s]+)/gi, "$1=[REDACTED]");
}
