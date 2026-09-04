// Canonical redaction layer (Operational Readiness Slice 4).
//
// One recursive, cycle-safe, bounded, deterministic redactor used at every
// boundary where data can leave the execution core. Uses BOTH key-based and
// value-pattern detection — field names alone are not trusted. Covers success
// AND failure paths (error normalization is redacted the same way).
//
// © MigraTeck LLC. Internal operational tooling.

export const MARKERS = {
  secret: '[REDACTED_SECRET]',
  token: '[REDACTED_TOKEN]',
  credential: '[REDACTED_CREDENTIAL]',
  path: '[REDACTED_PATH]',
  truncated: '[TRUNCATED]',
} as const;

const MAX_DEPTH = 8;
const MAX_NODES = 2_000;
const MAX_STRING = 8 * 1024;

/** Value patterns — order matters (most specific first). A match is replaced
 * wholesale; we never emit "first/last four chars" of a credential. */
const VALUE_PATTERNS: Array<{ re: RegExp; marker: string }> = [
  // PEM private key blocks.
  { re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, marker: MARKERS.credential },
  // Connection strings with embedded credentials (db / broker / generic scheme://user:pass@host).
  { re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s"'`]+/gi, marker: MARKERS.credential },
  // Bare connection strings (no creds but still sensitive infra endpoints).
  { re: /\b(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis|rediss|amqp|amqps):\/\/[^\s"'`]+/gi, marker: MARKERS.credential },
  // JWTs.
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, marker: MARKERS.token },
  // AWS access key id + typical secret access key value.
  { re: /\bAKIA[0-9A-Z]{16}\b/g, marker: MARKERS.credential },
  // Provider tokens (github, slack, stripe, openai-style sk-, generic prefixed).
  { re: /\b(?:gh[pousr]|xox[baprs]|sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, marker: MARKERS.token },
  // Engine approval tokens.
  { re: /\bappr_[A-Za-z0-9]{10,}\b/g, marker: MARKERS.token },
  // Long high-entropy hex/base64 blobs that look like keys (>= 32 chars).
  { re: /\b[A-Fa-f0-9]{40,}\b/g, marker: MARKERS.secret },
];

/** Absolute host paths (POSIX + Windows). Redacted only on metadata surfaces. */
const ABSOLUTE_PATH = /(?:\/(?:home|Users|root|etc|var|opt|srv|tmp)\/[^\s"'`:]+|[A-Za-z]:\\[^\s"'`]+)/g;

/** Keys whose VALUE is fully redacted regardless of content. */
const SENSITIVE_KEY = /(authorization|cookie|set-cookie|passwd|password|secret|token|api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credential|session[_-]?id|connection[_-]?string|db[_-]?url|database[_-]?url|dsn)/i;

/** Sensitive key/value assignments embedded in otherwise free-form strings.
 * Preserve the key for operator context, but never preserve any part of the
 * assigned value. Covers shell-style and prose assignments such as
 * `token=value` as well as JSON-like `"password": "value"`. */
const SENSITIVE_ASSIGNMENT = /(["']?(?:authorization|cookie|set-cookie|passwd|password|secret|token|api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credential|session[_-]?id|connection[_-]?string|db[_-]?url|database[_-]?url|dsn)["']?\s*[:=]\s*)(?:["'][^"'\r\n]*["']|[^\s,;\]}]+)/gi;

/** Env keys treated as sensitive (value redacted when logged as {key,value}). */
const SENSITIVE_ENV_KEY = /(SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL|DSN|CONN|AUTH|PRIVATE)/i;

export interface RedactOptions {
  /** Redact absolute host paths (metadata surfaces). Default true. */
  redactPaths?: boolean;
}

/** Redact secrets from a single string. Returns the sanitized value and whether
 * anything was redacted. Truncates past the cap with a [TRUNCATED] marker. */
export function redactString(input: string, opts: RedactOptions = {}): { value: string; redacted: boolean } {
  let s = input;
  let redacted = false;
  if (s.length > MAX_STRING) {
    s = s.slice(0, MAX_STRING) + ` ${MARKERS.truncated}`;
  }
  s = s.replace(SENSITIVE_ASSIGNMENT, (_match, prefix: string) => {
    redacted = true;
    return `${prefix}${MARKERS.secret}`;
  });
  for (const { re, marker } of VALUE_PATTERNS) {
    s = s.replace(re, () => {
      redacted = true;
      return marker;
    });
  }
  if (opts.redactPaths !== false) {
    s = s.replace(ABSOLUTE_PATH, () => {
      redacted = true;
      return MARKERS.path;
    });
  }
  return { value: s, redacted };
}

/** Recursively redact any value. Cycle-safe (WeakSet), depth + node bounded,
 * type-preserving where practical. Strings/objects/arrays/errors/maps/nested. */
export function redactValue(value: unknown, opts: RedactOptions = {}): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const walk = (v: unknown, depth: number): unknown => {
    if (nodes++ > MAX_NODES) return MARKERS.truncated;
    if (depth > MAX_DEPTH) return MARKERS.truncated;
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return redactString(v, opts).value;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v;
    if (typeof v === 'function' || typeof v === 'symbol') return '[unserializable]';
    if (v instanceof Error) return redactError(v, opts, walk, depth);
    if (typeof v === 'object') {
      if (seen.has(v)) return '[circular]';
      seen.add(v);
      if (Array.isArray(v)) return v.slice(0, 200).map((x) => walk(x, depth + 1));
      if (v instanceof Map) {
        const out: Record<string, unknown> = {};
        let i = 0;
        for (const [k, val] of v) {
          if (i++ > 200) break;
          out[String(k)] = SENSITIVE_KEY.test(String(k)) ? MARKERS.secret : walk(val, depth + 1);
        }
        return out;
      }
      if (v instanceof Set) return [...v].slice(0, 200).map((x) => walk(x, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEY.test(k) ? markerFor(k) : walk(val, depth + 1);
      }
      return out;
    }
    return String(v);
  };
  return walk(value, 0);
}

function markerFor(key: string): string {
  if (/token|api[_-]?key|access[_-]?key/i.test(key)) return MARKERS.token;
  if (/credential|private[_-]?key|connection|dsn|db[_-]?url|database[_-]?url/i.test(key)) return MARKERS.credential;
  return MARKERS.secret;
}

function redactError(
  err: Error,
  opts: RedactOptions,
  walk: (v: unknown, d: number) => unknown,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: err.name,
    message: redactString(err.message, opts).value,
  };
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') out.code = code;
  // Zod-style issues array (never leak raw values).
  const issues = (err as { issues?: unknown }).issues;
  if (Array.isArray(issues)) {
    out.issues = issues.slice(0, 50).map((i) => {
      const io = i as { path?: unknown; message?: unknown; code?: unknown };
      return { path: Array.isArray(io.path) ? io.path.join('.') : String(io.path ?? ''), message: redactString(String(io.message ?? ''), opts).value, code: io.code };
    });
  }
  if (err.cause !== undefined && depth < MAX_DEPTH) out.cause = walk(err.cause, depth + 1);
  return out;
}

/** Normalize + redact ANY thrown value into a safe, serializable shape for a
 * boundary response. Never includes a stack trace. */
export function sanitizeError(err: unknown, opts: RedactOptions = {}): { name: string; message: string; code?: string | number; cause?: unknown; issues?: unknown } {
  if (err instanceof Error) return redactError(err, opts, (v, d) => redactValue(v, opts), 0) as never;
  if (typeof err === 'string') return { name: 'Error', message: redactString(err, opts).value };
  return { name: 'Error', message: redactString(String(err), opts).value };
}

/** Redact command output (stdout/stderr) for operator display — value patterns
 * only (paths in program output are content, not host metadata). Returns
 * whether anything was redacted so callers can flag it. */
export function redactCommandOutput(text: string): { value: string; redacted: boolean } {
  const withoutAnsi = text.replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
  const result = redactString(withoutAnsi, { redactPaths: false });
  return { value: result.value, redacted: result.redacted || withoutAnsi !== text };
}

export { SENSITIVE_ENV_KEY };
