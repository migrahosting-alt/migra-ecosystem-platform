/**
 * MigraAI Engine — memory redaction.
 *
 * Nothing enters durable memory without passing through here. Secrets, approval
 * material, and credentials are stripped BEFORE storage — memory never becomes a
 * secret sink even when the raw content happened to contain one. Redaction is
 * conservative and pattern-based; it errs toward removing too much.
 */

const PATTERNS: Array<{ re: RegExp; label: string }> = [
  // JWTs (three base64url segments).
  { re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, label: 'jwt' },
  // OpenAI-style / generic secret keys.
  { re: /\bsk-[A-Za-z0-9]{16,}\b/g, label: 'api-key' },
  // AWS access key ids.
  { re: /\bAKIA[0-9A-Z]{12,}\b/g, label: 'aws-key' },
  // Bearer tokens in an Authorization header value.
  { re: /\bBearer\s+[A-Za-z0-9._-]{8,}/gi, label: 'bearer' },
  // Engine tool approval tokens.
  { re: /\bappr_[A-Za-z0-9]{6,}\b/g, label: 'approval-token' },
  // PEM private keys (whole block).
  { re: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, label: 'private-key' },
  // KEY=value / SECRET=value / PASSWORD=value / TOKEN=value assignments.
  { re: /\b([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY))\b\s*[:=]\s*\S+/gi, label: 'secret-assignment' },
];

export interface RedactionResult {
  text: string;
  redacted: string[];
}

/** Redact secret-shaped substrings from free text. Returns the cleaned text plus
 * the labels of what was removed (labels only — never the secret values). */
export function redactSecrets(input: string): RedactionResult {
  let text = input;
  const redacted: string[] = [];
  for (const { re, label } of PATTERNS) {
    if (re.test(text)) {
      redacted.push(label);
      text = text.replace(re, (m) =>
        label === 'secret-assignment' ? m.replace(/([:=]\s*)\S+/, '$1‹redacted›') : '‹redacted›',
      );
    }
    re.lastIndex = 0;
  }
  return { text, redacted };
}

/** Sanitize an arbitrary tool output into a compact, secret-free string suitable
 * for memory. Objects are shallow-serialized and truncated; never store a raw
 * unbounded payload. */
export function sanitizeForMemory(value: unknown, maxLen = 4000): string {
  let s: string;
  if (typeof value === 'string') s = value;
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  const cleaned = redactSecrets(s).text;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}
