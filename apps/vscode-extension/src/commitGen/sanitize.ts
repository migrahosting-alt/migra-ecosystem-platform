import { type BoundedDiff, type CommitConvention } from './prepare.js';

// Provider output is UNTRUSTED. Sanitize it into a {subject, body}: strip
// markdown fences, invalid control characters, fabricated trailers/metadata and
// command text, and never let invented issue numbers, breaking-change markers,
// scopes, or test claims survive. Enforce subject length/format policy. vscode-free.

export interface CommitMessage {
  subject: string;
  body: string;
}

// Trailers/metadata we NEVER fabricate — stripped from the body regardless of
// what the provider emitted (they would be unverifiable claims).
const FABRICATED_TRAILER =
  /^(Closes|Fixes|Resolves|Refs?|References|Co-authored-by|Signed-off-by|Reviewed-by|Tested(-by)?|Test Plan|BREAKING[ -]CHANGE)\b/i;

const COMMAND_LINE = /^\s*(?:\$|git|npm|npx|pnpm|yarn|node|bash|sh|curl|sudo)\b/i;

/** Keep newline and tab; drop other C0 controls and DEL. No control chars in source. */
function stripControlChars(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '\n' || ch === '\t') {
      out += ch;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) {
      continue;
    }
    out += ch;
  }
  return out;
}

function stripFences(text: string): string {
  return text.replace(/```[a-z]*\s*\n?/gi, '').replace(/```/g, '');
}

/** Remove invented issue references and breaking-change markers from a subject. */
function scrubSubject(subject: string, opts: { conventional: boolean; maxLength: number }): string {
  let s = subject.replace(/^["'`\s]+|["'`\s]+$/g, '');
  // Strip issue references like "#123", "(#123)", "GH-123", "JIRA-45".
  s = s.replace(/\(?#\d+\)?|\b(?:gh|[A-Z]{2,})-\d+\b/gi, '');
  if (!opts.conventional) {
    // Not a conventional repo: drop any invented "type(scope):" / "type!:" prefix.
    s = s.replace(/^[a-z]+(\([^)]+\))?!?:\s*/i, '');
  } else {
    // Conventional repo: allow a type(scope): prefix but strip an unevidenced "!".
    s = s.replace(/^([a-z]+(?:\([^)]+\))?)!:/i, '$1:');
  }
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/[.\s]+$/g, ''); // no trailing period/space
  if (s.length > opts.maxLength) {
    s = s.slice(0, opts.maxLength).replace(/\s+\S*$/, '').trimEnd();
  }
  return s;
}

export function sanitizeCommitMessage(raw: string, convention: CommitConvention): CommitMessage {
  const text = stripControlChars(stripFences(raw));
  const lines = text.split('\n').map((l) => l.replace(/\s+$/g, ''));
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) {
    return { subject: '', body: '' };
  }
  const subject = scrubSubject(lines[firstIdx]!, {
    conventional: convention.conventional,
    maxLength: convention.maxSubjectLength,
  });

  const bodyLines = lines
    .slice(firstIdx + 1)
    .filter((l) => !FABRICATED_TRAILER.test(l.trim()) && !COMMAND_LINE.test(l));
  while (bodyLines.length && bodyLines[0]!.trim() === '') {
    bodyLines.shift();
  }
  const body = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subject, body };
}

export interface SubjectValidation {
  ok: boolean;
  reason?: string;
}

export function validateSubject(subject: string, maxLength: number): SubjectValidation {
  if (subject.trim().length === 0) {
    return { ok: false, reason: 'empty subject' };
  }
  if (subject.includes('\n')) {
    return { ok: false, reason: 'subject spans multiple lines' };
  }
  if (subject.length > maxLength) {
    return { ok: false, reason: `subject exceeds ${maxLength} chars` };
  }
  return { ok: true };
}

/**
 * Deterministic commit-message fixture — the stub provider's contribution. Built
 * only from evidence in the bounded diff (file count + paths); it invents no
 * scope, issue, or breaking-change marker.
 */
export function deterministicCommitMessage(diff: BoundedDiff, convention: CommitConvention): CommitMessage {
  const n = diff.totalFiles;
  const noun = n === 1 ? 'file' : 'files';
  const subject = convention.conventional ? `chore: update ${n} ${noun}` : `Update ${n} ${noun}`;
  const bodyLines = diff.files.map((f) => `- ${f.status} ${f.path} (+${f.added}/-${f.removed})`);
  if (diff.truncated) {
    bodyLines.push('- (diff truncated for size)');
  }
  return {
    subject: scrubSubject(subject, { conventional: convention.conventional, maxLength: convention.maxSubjectLength }),
    body: bodyLines.join('\n'),
  };
}
