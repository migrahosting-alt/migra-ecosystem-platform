// MigraPilot — central redaction utility (Phase 12.7).
//
// Deterministic, dependency-free. Makes reports / journal payloads / diagnostics / (future) executor
// artifacts copy-safe so secrets are never logged. This is a PURE helper: it adds no runtime behavior,
// enables no action, and does not replace the existing per-module sanitizers (approval-store,
// ops-action-journal, image-provider, ops-provider) — it centralizes + makes the guarantee testable.

const REDACTED = "[REDACTED]";

// Sensitive object-KEY names (normalized: lowercased, separators stripped). Conservative — when a key
// looks sensitive the whole value is redacted, regardless of its content.
const SENSITIVE_KEY_RE =
  /(password|passphrase|passwd|secret|clientsecret|token|accesstoken|refreshtoken|apikey|authorization|setcookie|cookie|privatekey|credential|connectionstring|databaseurl|authdatabaseurl|dbcoreurl|databasepanelurl|bearer)/i;

function normalizeKey(k: string): string {
  return k.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isSensitiveKey(k: string): boolean {
  const n = normalizeKey(k);
  return n === "pass" || SENSITIVE_KEY_RE.test(n);
}

// Redact secret PATTERNS inside a free-text string (applied to string values under non-sensitive keys,
// so secrets embedded in messages/notes are caught too). Keeps non-sensitive host/db context for URLs.
export function redactString(s: string): string {
  let out = s;
  // PEM private key blocks
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    "[REDACTED PRIVATE KEY]",
  );
  // DB / cache / broker connection URLs — drop credentials, keep scheme+host+db
  out = out.replace(
    /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/)[^/@\s'"]*@/gi,
    `$1${REDACTED}@`,
  );
  // Authorization headers
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/\-]+=*/gi, "Bearer [REDACTED]");
  out = out.replace(/\bBasic\s+[A-Za-z0-9+/]+=*/g, "Basic [REDACTED]");
  // Stripe-style SECRET keys (sk_/rk_ live|test). Public pk_ keys are intentionally left intact.
  out = out.replace(/\b(sk|rk)_(live|test)_[A-Za-z0-9]+/g, "$1_$2_[REDACTED]");
  return out;
}

// Recursively redact any value. Preserves shape; sensitive keys -> [REDACTED]; strings pattern-scrubbed;
// arrays/nested handled; circular refs -> "[Circular]"; null/undefined/number/boolean unchanged.
export function redactPilotValue(input: unknown, _seen?: WeakSet<object>): unknown {
  const seen = _seen ?? new WeakSet<object>();
  if (input === null || input === undefined) return input;
  const t = typeof input;
  if (t === "string") return redactString(input as string);
  if (t === "number" || t === "boolean" || t === "bigint") return input;
  if (t === "function" || t === "symbol") return undefined;

  if (Array.isArray(input)) {
    if (seen.has(input)) return "[Circular]";
    seen.add(input);
    const r = input.map((v) => redactPilotValue(v, seen));
    seen.delete(input);
    return r;
  }
  if (t === "object") {
    const obj = input as Record<string, unknown>;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactPilotValue(obj[k], seen);
    }
    seen.delete(obj);
    return out;
  }
  return REDACTED; // unknown type — fail closed
}

// Convenience: redacted JSON string (deterministic for a given input).
export function redactPilotJson(input: unknown): string {
  return JSON.stringify(redactPilotValue(input));
}
