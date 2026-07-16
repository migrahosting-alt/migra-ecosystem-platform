/**
 * MigraAI Engine — best-effort git metadata for a workspace root.
 *
 * Reads `.git/HEAD` (branch) and `.git/config` (origin remote) without shelling
 * out. Never throws — a non-git root simply yields `{}`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function gitInfo(root: string): Promise<{ repo?: string; branch?: string }> {
  const out: { repo?: string; branch?: string } = {};
  try {
    const head = await fs.readFile(path.join(root, '.git', 'HEAD'), 'utf8');
    const m = /ref:\s*refs\/heads\/(.+)\s*$/.exec(head.trim());
    if (m) out.branch = m[1];
    else if (/^[0-9a-f]{7,40}$/.test(head.trim())) out.branch = `detached@${head.trim().slice(0, 8)}`;
  } catch {
    /* not a git repo */
  }
  try {
    const config = await fs.readFile(path.join(root, '.git', 'config'), 'utf8');
    const m = /\[remote "origin"\][^[]*?url\s*=\s*(.+)\s*$/m.exec(config);
    if (m) out.repo = m[1]!.trim();
  } catch {
    /* no remote */
  }
  return out;
}
