// Folder-scoped chat questions. In a large monorepo, "what are MigraCMS's routes
// and Prisma models?" grounds poorly because retrieval searches the WHOLE tree
// and can land on a copy. If the user names a folder — an absolute path, or a
// distinctive directory name like `migracms-enterprise` — scope retrieval to
// THAT folder so the answer is about the component they mean.
//
// The candidate EXTRACTION is pure + unit-tested; directory existence and the
// name→path lookup are injected so the resolver stays testable without vscode.

import { extractPathCandidates } from './taskRoot.js';

/** English words that follow "in/for/…" as idioms, never a folder name. */
const IDIOM = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'general', 'production', 'particular',
  'order', 'fact', 'short', 'place', 'case', 'code', 'it', 'them', 'here', 'there', 'total',
  'detail', 'depth', 'sync', 'progress', 'return', 'addition', 'practice', 'terms', 'part',
]);

/** Pull folder candidates from a question: absolute paths, plus distinctive
 * directory-name tokens (hyphenated like `migracms-enterprise`, or a plain name
 * introduced by "in/for/under/inside/within … [folder|directory|project|package|
 * app|repo|module]"). Conservative — the resolver still verifies each exists. */
export function extractScopeCandidates(prompt: string): { paths: string[]; names: string[] } {
  const paths = extractPathCandidates(prompt);
  const names = new Set<string>();
  // Hyphenated tokens are almost always a project/dir name (migracms-enterprise,
  // brain-service, pilot-web). Bare enough to be distinctive.
  for (const m of prompt.matchAll(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/gi)) {
    const t = m[1]!;
    if (!/\.(com|org|net|io|dev|app|ai|co|js|ts|py|md|json)$/i.test(t)) names.add(t);
  }
  const FOLDER_NOUN = 'folder|dir(?:ectory)?|project|package|app|repo|module|service|component';
  // A plain name introduced by a preposition: "in migracms", "under auth".
  for (const m of prompt.matchAll(new RegExp(`\\b(?:in|for|under|inside|within|of)\\s+(?:the\\s+)?([a-z][\\w]{2,})\\b(?:\\s+(?:${FOLDER_NOUN}))?`, 'gi'))) {
    const t = m[1]!;
    if (!IDIOM.has(t.toLowerCase())) names.add(t);
  }
  // A name followed by a folder noun: "the auth package", "the api module".
  for (const m of prompt.matchAll(new RegExp(`\\b([a-z][\\w]{2,})\\s+(?:${FOLDER_NOUN})\\b`, 'gi'))) {
    const t = m[1]!;
    if (!IDIOM.has(t.toLowerCase())) names.add(t);
  }
  return { paths, names: [...names] };
}

export interface ScopeDeps {
  /** True iff the path exists and is a directory. */
  isDirectory(path: string): Promise<boolean>;
  /** Find directories in the workspace whose name equals `name` (basename match).
   * Returns absolute paths; empty if none. */
  findDirs(name: string): Promise<string[]>;
}

export interface ResolvedScope {
  root: string;
  /** How it was found — for the "scoped to …" note. */
  label: string;
}

/** True iff a path looks like a non-canonical copy (a `-starter` scaffold, a
 * backup/archive, a `-old`/`-copy` duplicate). Used to prefer the real source. */
export function isCopyPath(p: string): boolean {
  return /(?:[-_](?:starter|backup|bak|orig|deprecated))(?:[-_/.]|$)|[-_]old(?:[-_/.]|$)|[-_]copy(?:[-_/.]|$)|(?:^|\/)(?:backups?|archives?|\.backups?)\//i.test(p);
}

/** Pick the best directory match: prefer a NON-copy path, then the shortest
 * (closest to a top-level canonical location). */
export function pickBestDir(paths: readonly string[]): string | undefined {
  if (paths.length === 0) return undefined;
  return [...paths].sort((a, b) => {
    const ca = isCopyPath(a) ? 1 : 0;
    const cb = isCopyPath(b) ? 1 : 0;
    if (ca !== cb) return ca - cb; // non-copy first
    return a.length - b.length; // shorter (more canonical) first
  })[0];
}

/** Resolve a folder scope for a chat question, or undefined to use the default
 * workspace. Absolute paths win; then a named directory (canonical over copy). */
export async function resolveChatScope(prompt: string, deps: ScopeDeps): Promise<ResolvedScope | undefined> {
  const { paths, names } = extractScopeCandidates(prompt);
  for (const p of paths) {
    if (await deps.isDirectory(p)) return { root: p, label: p };
  }
  // Prefer longer, more-distinctive names (a hyphenated project name over a bare
  // word); cap the lookups so a question never fans out to many find calls.
  const ordered = [...names].sort((a, b) => b.length - a.length).slice(0, 3);
  for (const name of ordered) {
    const dirs = await deps.findDirs(name);
    const best = pickBestDir(dirs);
    if (best) return { root: best, label: name };
  }
  return undefined;
}
