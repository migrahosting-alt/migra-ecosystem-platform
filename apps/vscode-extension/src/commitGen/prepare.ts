import { type ChangedFile, type GitRunner, fileDiff } from './git.js';

// Prepare a bounded, redacted, classified view of the changes for the provider.
// Binary/generated/lockfile/oversized files are SUMMARIZED, never transmitted
// wholesale; secrets are redacted before anything leaves the machine. vscode-free.

const REDACTED = '‹redacted›';

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g, // JWT
  /\bsk-[A-Za-z0-9]{16,}\b/g, // OpenAI-style key
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bBearer\s+[A-Za-z0-9._-]{16,}/g,
  /\b(?:password|passwd|secret|api[_-]?key|token|access[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"'#]{6,}["']?/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'go.sum',
]);

export function isLockfile(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  return LOCKFILES.has(base);
}

export function isGenerated(path: string): boolean {
  const p = path.toLowerCase();
  return (
    /(^|\/)(dist|build|out|coverage|\.next|node_modules)\//.test(p) ||
    /\.min\.(js|css)$/.test(p) ||
    /\.(map|snap)$/.test(p) ||
    /(^|\/)__generated__\//.test(p) ||
    /\.(pb|generated)\.[a-z]+$/.test(p)
  );
}

export type FileCategory = 'normal' | 'binary' | 'lockfile' | 'generated' | 'oversized';

export function classifyFile(file: ChangedFile, diffLength: number, maxPerFile: number): FileCategory {
  if (file.binary) return 'binary';
  if (isLockfile(file.path)) return 'lockfile';
  if (isGenerated(file.path)) return 'generated';
  if (diffLength > maxPerFile) return 'oversized';
  return 'normal';
}

export interface BoundedFile {
  path: string;
  status: string;
  added: number;
  removed: number;
  category: FileCategory;
  /** Redacted diff text for 'normal' files; a one-line summary otherwise. */
  content: string;
}

export interface BoundedDiff {
  files: BoundedFile[];
  totalFiles: number;
  truncated: boolean;
  includedUnstaged: boolean;
}

export interface BoundOptions {
  maxTotalChars?: number;
  maxPerFileChars?: number;
}

function summaryLine(file: ChangedFile, category: FileCategory): string {
  const reason =
    category === 'binary'
      ? 'binary file'
      : category === 'lockfile'
        ? 'lockfile'
        : category === 'generated'
          ? 'generated file'
          : 'oversized diff';
  return `[${reason}: ${file.status} ${file.path} (+${file.added}/-${file.removed})]`;
}

/**
 * Build a bounded, redacted diff payload. Normal files contribute redacted diff
 * text up to a total budget; everything else (binary/generated/lockfile/oversized)
 * is summarized. When the total budget is exhausted, remaining normal files are
 * summarized and `truncated` is set.
 */
export async function buildBoundedDiff(
  git: GitRunner,
  files: ChangedFile[],
  staged: boolean,
  opts: BoundOptions = {},
  signal?: AbortSignal,
): Promise<BoundedDiff> {
  const maxTotal = opts.maxTotalChars ?? 12000;
  const maxPerFile = opts.maxPerFileChars ?? 4000;
  const out: BoundedFile[] = [];
  let used = 0;
  let truncated = false;

  for (const file of files) {
    let raw = '';
    let category: FileCategory;
    if (file.binary || isLockfile(file.path) || isGenerated(file.path)) {
      category = file.binary ? 'binary' : isLockfile(file.path) ? 'lockfile' : 'generated';
    } else {
      raw = redactSecrets(await fileDiff(git, staged, file.path, signal));
      category = classifyFile(file, raw.length, maxPerFile);
    }

    if (category !== 'normal') {
      out.push({ path: file.path, status: file.status, added: file.added, removed: file.removed, category, content: summaryLine(file, category) });
      continue;
    }
    if (used + raw.length > maxTotal) {
      truncated = true;
      out.push({
        path: file.path,
        status: file.status,
        added: file.added,
        removed: file.removed,
        category: 'oversized',
        content: summaryLine(file, 'oversized'),
      });
      continue;
    }
    used += raw.length;
    out.push({ path: file.path, status: file.status, added: file.added, removed: file.removed, category: 'normal', content: raw });
  }

  return { files: out, totalFiles: files.length, truncated, includedUnstaged: !staged };
}

// ── convention detection (conservative) ──────────────────────────────────────

export type ConventionSetting = 'auto' | 'always' | 'never';

export interface CommitConvention {
  conventional: boolean;
  maxSubjectLength: number;
}

const CONVENTIONAL_RE = /^[a-z]+(\([^)]+\))?!?:\s/i;

export function detectConvention(subjects: string[], setting: ConventionSetting, maxSubjectLength = 72): CommitConvention {
  if (setting === 'always') {
    return { conventional: true, maxSubjectLength };
  }
  if (setting === 'never') {
    return { conventional: false, maxSubjectLength };
  }
  // auto: only infer conventional when the recent history clearly uses it.
  if (subjects.length === 0) {
    return { conventional: false, maxSubjectLength };
  }
  const conv = subjects.filter((s) => CONVENTIONAL_RE.test(s)).length;
  return { conventional: conv / subjects.length >= 0.5, maxSubjectLength };
}
