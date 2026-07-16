import { createHash } from 'node:crypto';
import path from 'node:path';
import { PilotError } from '@migrapilot/pilot-client';

// Test-generation proposal: parsing, validation, confirmation binding, and
// apply+read-back. vscode-free and fs-injected so every safety invariant is
// unit-testable. All writes are guarded: paths must stay inside the workspace,
// creates never overwrite, updates only touch existing test files, no provider/
// auth/correlation/approval internals may appear in generated contents, and a
// proposal that changed since review is refused.

export type TestFileMode = 'create' | 'update';

export interface TestFile {
  path: string; // workspace-relative, forward-slash
  contents: string;
  mode: TestFileMode;
}

export interface TestProposal {
  files: TestFile[];
}

export class ProposalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalParseError';
  }
}

/** Injected filesystem, scoped to the workspace root. Paths are ws-relative. */
export interface WorkspaceFs {
  exists(relPath: string): Promise<boolean>;
  read(relPath: string): Promise<string>;
  write(relPath: string, contents: string): Promise<void>;
}

/** Resolve a proposal path to a normalized workspace-relative path, or throw if
 * it escapes the workspace root. */
export function resolveInsideWorkspace(root: string, p: string): string {
  const absRoot = path.resolve(root);
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(absRoot, p);
  const rel = path.relative(absRoot, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PilotError('INVALID_STATE', `Generated path escapes the workspace: ${p}`);
  }
  return rel.split(path.sep).join('/');
}

export function isTestFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(lower) || /(^|\/)(__tests__|tests?)\//.test(lower);
}

// Reject generated contents that echo our internals. We never place secrets in
// the prompt, so this is a defense-in-depth guard against a provider echoing them.
const LEAK_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
  /\bapprovals?[_-]?(token|id)\b\s*[:=]/i,
  /x-request-id\s*[:=]/i,
  /\bapi[_-]?key\b\s*[:=]\s*["'][A-Za-z0-9._-]{12,}/i,
];

export function containsLeakedInternals(text: string): boolean {
  return LEAK_PATTERNS.some((re) => re.test(text));
}

/** Extract a JSON proposal from raw provider text (bare JSON or ```json fenced),
 * and validate its shape. Throws ProposalParseError on anything malformed. */
export function parseProposal(raw: string): TestProposal {
  const json = extractJson(raw);
  if (json === undefined) {
    throw new ProposalParseError('no JSON object found in provider output');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ProposalParseError(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { files?: unknown }).files)) {
    throw new ProposalParseError('proposal must be an object with a files[] array');
  }
  const files = (parsed as { files: unknown[] }).files.map((f, i) => {
    if (typeof f !== 'object' || f === null) {
      throw new ProposalParseError(`files[${i}] is not an object`);
    }
    const o = f as Record<string, unknown>;
    if (typeof o.path !== 'string' || o.path.length === 0) {
      throw new ProposalParseError(`files[${i}].path missing`);
    }
    if (typeof o.contents !== 'string') {
      throw new ProposalParseError(`files[${i}].contents missing`);
    }
    if (o.mode !== 'create' && o.mode !== 'update') {
      throw new ProposalParseError(`files[${i}].mode must be create|update`);
    }
    return { path: o.path, contents: o.contents, mode: o.mode } satisfies TestFile;
  });
  if (files.length === 0) {
    throw new ProposalParseError('proposal has no files');
  }
  return { files };
}

function extractJson(raw: string): string | undefined {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fence ? fence[1]! : raw;
  const start = candidate.indexOf('{');
  if (start === -1) {
    return undefined;
  }
  // Balance braces to find the end of the first object.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return candidate.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/** Validate a proposal against the workspace: paths inside root, creates don't
 * overwrite, updates only touch existing test files, no leaked internals. */
export async function validateProposal(
  proposal: TestProposal,
  root: string,
  fs: Pick<WorkspaceFs, 'exists'>,
): Promise<ValidationResult> {
  for (const file of proposal.files) {
    let rel: string;
    try {
      rel = resolveInsideWorkspace(root, file.path);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    if (containsLeakedInternals(file.contents)) {
      return { ok: false, reason: `generated contents for ${rel} contain disallowed internal material` };
    }
    const exists = await fs.exists(rel);
    if (file.mode === 'create' && exists) {
      return { ok: false, reason: `refusing to overwrite existing file ${rel} (mode=create)` };
    }
    if (file.mode === 'update') {
      if (!exists) {
        return { ok: false, reason: `cannot update non-existent file ${rel}` };
      }
      if (!isTestFile(rel)) {
        return { ok: false, reason: `refusing to update non-test source file ${rel}` };
      }
    }
  }
  return { ok: true };
}

/** Stable fingerprint binding a reviewed proposal to its later apply. */
export function fingerprintProposal(proposal: TestProposal): string {
  const canonical = JSON.stringify(
    [...proposal.files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => ({ path: f.path, mode: f.mode, contents: f.contents })),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

export type ApplyResult =
  | { status: 'applied'; written: string[]; verified: boolean }
  | { status: 'refused'; reason: string }
  | { status: 'partial'; written: string[]; failed: string; reason: string };

/**
 * Apply a proposal — only if its fingerprint still matches what was reviewed
 * (a changed proposal is refused, requiring a new confirmation). Re-validates,
 * writes, then reads back to verify. A write failure fails closed and reports
 * exactly which files were written.
 */
export async function applyTestProposal(
  proposal: TestProposal,
  reviewedFingerprint: string,
  root: string,
  fs: WorkspaceFs,
): Promise<ApplyResult> {
  if (fingerprintProposal(proposal) !== reviewedFingerprint) {
    return { status: 'refused', reason: 'proposal changed since review — a new confirmation is required' };
  }
  const validation = await validateProposal(proposal, root, fs);
  if (!validation.ok) {
    return { status: 'refused', reason: validation.reason };
  }

  const written: string[] = [];
  for (const file of proposal.files) {
    const rel = resolveInsideWorkspace(root, file.path);
    try {
      await fs.write(rel, file.contents);
      written.push(rel);
    } catch (err) {
      return {
        status: 'partial',
        written,
        failed: rel,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Read-back: success requires the workspace to actually contain what we wrote.
  let verified = true;
  for (const file of proposal.files) {
    const rel = resolveInsideWorkspace(root, file.path);
    try {
      const readBack = await fs.read(rel);
      if (readBack !== file.contents) {
        verified = false;
      }
    } catch {
      verified = false;
    }
  }
  return { status: 'applied', written, verified };
}
