import type { WorkspaceFs } from './adapters.js';
import { WorkspaceToolError } from './errors.js';

/**
 * Resolve a client-supplied relative path to an absolute path that is PROVEN to
 * stay inside the workspace root — the single containment chokepoint for every
 * workspace tool. Rejects:
 *   - absolute paths (a client may only name paths relative to the root);
 *   - `..` traversal that escapes the root (lexical check);
 *   - symlink escape: the nearest existing ancestor's REAL path must remain inside
 *     the root's real path, so a symlink placed inside the root that points outside
 *     is refused.
 */
export function containedPath(root: string, relPath: string, fs: WorkspaceFs): string {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new WorkspaceToolError('INVALID_INPUT', 'A relative path is required.');
  }
  if (fs.isAbsolute(relPath)) {
    throw new WorkspaceToolError('ABSOLUTE_PATH', `Absolute paths are not allowed: ${relPath}`);
  }

  const resolved = fs.resolve(root, relPath);
  const rootWithSep = root.endsWith(fs.sep) ? root : root + fs.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new WorkspaceToolError('PATH_ESCAPE', `Path escapes the workspace root: ${relPath}`);
  }

  // Symlink containment. The root must exist and canonicalize; the target's nearest
  // existing ancestor must canonicalize to within the root's real path.
  const realRoot = fs.realPath(root);
  const realRootWithSep = realRoot.endsWith(fs.sep) ? realRoot : realRoot + fs.sep;

  let probe = resolved;
  while (!fs.exists(probe)) {
    const parent = fs.dirname(probe);
    if (parent === probe) break; // reached filesystem root without finding an existing ancestor
    probe = parent;
  }
  const realProbe = fs.realPath(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRootWithSep)) {
    throw new WorkspaceToolError('PATH_ESCAPE', `Path resolves via a symlink outside the workspace root: ${relPath}`);
  }
  return resolved;
}
