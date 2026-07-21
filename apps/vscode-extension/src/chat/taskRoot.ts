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
  // Windows drive paths: C:\Users\me\proj or C:/Users/me/proj.
  //
  // Spaces are ALLOWED and then progressively trimmed: `T:\MigraAccess Command`
  // is a real folder, but stopping at the first space silently truncated it to
  // `T:\MigraAccess` and the run reported that folder "was not found". Emitting
  // the longest form first and shorter prefixes after lets the existence check
  // decide, which is what it is there for.
  for (const m of prompt.matchAll(/\b[A-Za-z]:[\\/][^\n"'`<>|?*]+/g)) {
    const full = m[0].trimEnd();
    push(full);
    // …then drop trailing words, so prose after the path cannot swallow it.
    let rest = full;
    while (/\s/.test(rest)) {
      rest = rest.replace(/\s+\S*$/, '');
      if (/^[A-Za-z]:[\\/].+/.test(rest)) push(rest);
    }
  }
  // UNC paths: \\server\share\proj
  for (const m of prompt.matchAll(/\\\\[^\s"'`<>|?*\n]+/g)) push(m[0]);
  // Home paths: ~/projects/app
  for (const m of prompt.matchAll(/(?:^|\s)(~\/[^\s"'`<>|?*\n]+)/g)) push(m[1]);
  // POSIX absolute with >= 2 segments (avoids matching a bare "/deep" command).
  for (const m of prompt.matchAll(/(?:^|\s)(\/[^\s"'`<>|?*\n/]+(?:\/[^\s"'`<>|?*\n/]+)+\/?)/g)) push(m[1]);
  return [...new Set(out)];
}

/** Same folder, written the other host's way.
 *
 * The extension host and the folder do not have to agree on path style: in WSL
 * the picker browses the LINUX tree, so a Windows path like `T:\MigraWatch` is
 * simply "a path that does not exist" — the owner hit exactly that, typing
 * `t:/MigraWatch/migrawatch` into a dialog listing `/bin`, `/boot`, `/dev`.
 * Translating both ways lets either spelling resolve; the caller still verifies
 * each candidate really is a directory, so a wrong guess costs nothing. */
export function pathAlternatives(p: string): string[] {
  const out = [p];
  const win = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (win) out.push(`/mnt/${win[1]!.toLowerCase()}/${win[2]!.replace(/\\/g, '/')}`);
  const wsl = /^\/mnt\/([A-Za-z])\/(.*)$/.exec(p);
  if (wsl) out.push(`${wsl[1]!.toUpperCase()}:\\${wsl[2]!.replace(/\//g, '\\')}`);
  return [...new Set(out.filter(Boolean))];
}

export type RootSource = 'explicit-path' | 'workspace' | 'picked' | 'created';

export interface ResolveRootDeps {
  /** The first open workspace folder path, if any. */
  openWorkspace?: string;
  /** True iff the path exists AND is a directory. */
  isDirectory(path: string): Promise<boolean>;
  /** Ask the user to pick a folder; returns its path or undefined if cancelled.
   * `near` is a hint (e.g. a named-but-missing path) to open the dialog at. */
  pickFolder(near?: string): Promise<string | undefined>;
  /** Ask whether to CREATE a folder the user named that does not exist yet. */
  confirmCreate?(path: string): Promise<boolean>;
  /** Create a directory (and any missing parents). */
  createDirectory?(path: string): Promise<void>;
}

export interface ResolvedRoot {
  root: string;
  source: RootSource;
  /** A path the user named that did not exist — surfaced so the caller can note it. */
  missingNamed?: string;
  /** Set when the folder was created for this task. */
  created?: boolean;
}

/** Resolve the target folder for a task. Returns undefined only if a picker was
 * needed and the user cancelled. */
export async function resolveTaskRoot(prompt: string, deps: ResolveRootDeps): Promise<ResolvedRoot | undefined> {
  const candidates = extractPathCandidates(prompt).flatMap(pathAlternatives);
  let missingNamed: string | undefined;
  for (const c of candidates) {
    if (await deps.isDirectory(c)) return { root: c, source: 'explicit-path' };
    missingNamed ??= c; // remember the first named-but-missing path
  }
  // A path was named but doesn't exist. Starting a NEW project is the common
  // case here — the folder is supposed to be new — and the picker can only
  // select folders that already exist, so it dead-ends: the owner could not
  // begin a new app without first creating the directory by hand. Offer to
  // create it, and only fall back to the picker if that is declined.
  if (missingNamed) {
    if (deps.confirmCreate && deps.createDirectory && (await deps.confirmCreate(missingNamed))) {
      await deps.createDirectory(missingNamed);
      return { root: missingNamed, source: 'created', created: true };
    }
    const picked = await pickExisting(deps, missingNamed);
    return picked ? { root: picked, source: 'picked', missingNamed } : undefined;
  }
  if (deps.openWorkspace) return { root: deps.openWorkspace, source: 'workspace' };
  const picked = await pickExisting(deps);
  return picked ? { root: picked, source: 'picked' } : undefined;
}

/** A PICKED path still has to exist on this host before we build in it.
 *
 * The owner ended up "Working in `t:\`" — a Windows drive root, which does not
 * exist from the WSL extension host, so every tool call in that run was doomed
 * and it looked as though the agent had no build tools at all. A picked path is
 * now translated the same way a typed one is, and rejected if nothing resolves. */
async function pickExisting(deps: ResolveRootDeps, near?: string): Promise<string | undefined> {
  const picked = await deps.pickFolder(near);
  if (!picked) return undefined;
  for (const c of pathAlternatives(picked)) {
    if (await deps.isDirectory(c)) return c;
  }
  return undefined;
}
