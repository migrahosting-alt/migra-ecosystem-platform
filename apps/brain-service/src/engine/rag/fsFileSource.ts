/**
 * MigraAI Engine — filesystem file source for indexing.
 *
 * Walks a workspace root, applying {@link Exclusions} (secrets/binary/generated +
 * .gitignore + MigraAI list) and hard bounds (max files, max file size). Reads
 * text only; anything with NUL bytes is skipped. Never returns a whole repo's
 * worth of unbounded content.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Exclusions, DEFAULT_MIGRAAI_EXCLUSIONS } from './exclusions.js';
import type { FileSource } from './indexService.js';

export class FsFileSource implements FileSource {
  constructor(
    private readonly root: string,
    private readonly maxFiles = 4000,
    private readonly maxFileSize = 200 * 1024,
  ) {}

  async files(): Promise<Array<{ relPath: string; content: string }>> {
    const gitignore = await fs.readFile(path.join(this.root, '.gitignore'), 'utf8').catch(() => '');
    const excl = new Exclusions({ gitignore, extra: DEFAULT_MIGRAAI_EXCLUSIONS });
    const out: Array<{ relPath: string; content: string }> = [];
    await this.walk(this.root, '', excl, out);
    return out;
  }

  private async walk(abs: string, rel: string, excl: Exclusions, out: Array<{ relPath: string; content: string }>): Promise<void> {
    if (out.length >= this.maxFiles) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    // A per-package `.gitignore` is what actually ignores most build output in a
    // monorepo. Register it BEFORE filtering or descending: directory verdicts are
    // memoized, so a layer added afterwards would miss its own subtree.
    if (rel && entries.some((e) => e.isFile() && e.name === '.gitignore')) {
      const nested = await fs.readFile(path.join(abs, '.gitignore'), 'utf8').catch(() => '');
      if (nested) excl.addNested(rel, nested);
    }

    for (const ent of entries) {
      if (out.length >= this.maxFiles) return;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      const childAbs = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        // Ask as a DIRECTORY, so a directory-only pattern (`build/`) matches and a
        // same-named file's rules do not. Pruning here is safe and is what git
        // does: an excluded directory can never hold a re-included descendant.
        if (!excl.shouldDescend(childRel)) continue;
        await this.walk(childAbs, childRel, excl, out);
      } else if (ent.isFile()) {
        if (excl.isExcluded(childRel)) continue;
        try {
          const stat = await fs.stat(childAbs);
          if (stat.size > this.maxFileSize || stat.size === 0) continue;
          const content = await fs.readFile(childAbs, 'utf8');
          if (/\u0000/.test(content)) continue; // NUL byte -> binary; skip
          out.push({ relPath: childRel, content });
        } catch {
          /* unreadable — skip */
        }
      }
    }
  }
}
