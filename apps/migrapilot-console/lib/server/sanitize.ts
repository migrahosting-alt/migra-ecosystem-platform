const SENSITIVE_KEY = /(secret|token|password|api[-_]?key|authorization|cookie|signature|private)/i;

export function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  if (typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(inner);
  }
  return output;
}
