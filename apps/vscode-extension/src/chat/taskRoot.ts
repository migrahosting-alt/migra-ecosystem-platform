// Resolve which folder a build/engineer task runs in. Historically the engineer
// was hard-locked to the first open workspace folder, so with no folder open —
// or when the user wants to build somewhere ELSE on their machine — it couldn't
// act. This resolves a target directory from, in order:
//   1. an explicit absolute path in the user's message (Windows, POSIX, or ~),
//   2. the open workspace folder,
//   3. an interactive folder picker (the "at least ask for the path" fallback).
//
// The path EXTRACTOR is pure + unit-tested here; the existence check and the
// picker are injected so the resolver stays testable without vscode.

/** Pull candidate absolute-directory paths out of free text. Liberal by design —
 * the resolver verifies each candidate exists as a directory, so a stray match
 * that isn't a real folder is simply skipped. Ordered most-specific first. */
export function extractPathCandidates(prompt: string): string[] {
  const out: string[] = [];
  const push = (s: string | undefined): void => {
    if (!s) return;
    const t = s.trim().replace(/[)\].,;:'"`]+$/, ''); // trailing punctuation from prose
    if (t) out.push(t);
  };
  // Quoted paths first ("C:\A B\proj", '/home/me/app') — quotes capture spaces.
  for (const m of prompt.matchAll(/["'`]([^"'`\n]{2,})["'`]/g)) {
    const c = m[1];
    if (c && (/^[A-Za-z]:[\\/]/.test(c) || c.startsWith('/') || c.startsWith('~/') || c.startsWith('\\\\'))) push(c);
  }
  // Windows drive paths: C:\Users\me\proj or C:/Users/me/proj
  for (const m of prompt.matchAll(/\b[A-Za-z]:[\\/][^\s"'`<>|?*\n]+/g)) push(m[0]);
  // UNC paths: \\server\share\proj
  for (const m of prompt.matchAll(/\\\\[^\s"'`<>|?*\n]+/g)) push(m[0]);
  // Home paths: ~/projects/app
  for (const m of prompt.matchAll(/(?:^|\s)(~\/[^\s"'`<>|?*\n]+)/g)) push(m[1]);
  // POSIX absolute with >= 2 segments (avoids matching a bare "/deep" command).
  for (const m of prompt.matchAll(/(?:^|\s)(\/[^\s"'`<>|?*\n/]+(?:\/[^\s"'`<>|?*\n/]+)+\/?)/g)) push(m[1]);
  return [...new Set(out)];
}

export type RootSource = 'explicit-path' | 'workspace' | 'picked';

export interface ResolveRootDeps {
  /** The first open workspace folder path, if any. */
  openWorkspace?: string;
  /** True iff the path exists AND is a directory. */
  isDirectory(path: string): Promise<boolean>;
  /** Ask the user to pick a folder; returns its path or undefined if cancelled.
   * `near` is a hint (e.g. a named-but-missing path) to open the dialog at. */
  pickFolder(near?: string): Promise<string | undefined>;
}

export interface ResolvedRoot {
  root: string;
  source: RootSource;
  /** A path the user named that did not exist — surfaced so the caller can note it. */
  missingNamed?: string;
}

/** Resolve the target folder for a task. Returns undefined only if a picker was
 * needed and the user cancelled. */
export async function resolveTaskRoot(prompt: string, deps: ResolveRootDeps): Promise<ResolvedRoot | undefined> {
  const candidates = extractPathCandidates(prompt);
  let missingNamed: string | undefined;
  for (const c of candidates) {
    if (await deps.isDirectory(c)) return { root: c, source: 'explicit-path' };
    missingNamed ??= c; // remember the first named-but-missing path
  }
  // A path was named but doesn't exist → ASK (don't silently use a different
  // folder than the one the user pointed at).
  if (missingNamed) {
    const picked = await deps.pickFolder(missingNamed);
    return picked ? { root: picked, source: 'picked', missingNamed } : undefined;
  }
  if (deps.openWorkspace) return { root: deps.openWorkspace, source: 'workspace' };
  const picked = await deps.pickFolder();
  return picked ? { root: picked, source: 'picked' } : undefined;
}
