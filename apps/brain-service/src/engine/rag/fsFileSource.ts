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

/** The root could not be read at all — distinct from a root that is empty. */
export class FileSourceUnavailableError extends Error {
  readonly code = 'SOURCE_UNAVAILABLE';
  constructor(readonly root: string, override readonly cause: unknown) {
    super(`Index root is unreadable: ${root}. This is NOT an empty library — nothing was read.`);
    this.name = 'FileSourceUnavailableError';
  }
}

export class FsFileSource implements FileSource {
  constructor(
    private readonly root: string,
    private readonly maxFiles = 4000,
    private readonly maxFileSize = 200 * 1024,
  ) {}

  async files(): Promise<Array<{ relPath: string; content: string }>> {
    /*
     * AN UNREADABLE ROOT IS NOT AN EMPTY LIBRARY.
     *
     * `walk` swallows a readdir failure and returns, so a root that does not
     * exist, or that this process cannot read, produced an empty list —
     * indistinguishable from a genuinely empty directory. `sync` then reported
     * success with `files: 0`, and the user was told their library indexed fine
     * while nothing had been read at all.
     *
     * Observed during the PostgreSQL candidate gate: the service runs with
     * ProtectHome=true, so a root under /home was invisible to it and the sync
     * reported ok with zero files.
     *
     * The ROOT is therefore checked explicitly and its failure raised. A
     * subdirectory that cannot be read is still skipped — one unreadable subtree
     * should not fail an otherwise good index — but the root is the difference
     * between "nothing here" and "could not look".
     */
    try {
      await fs.readdir(this.root);
    } catch (error) {
      throw new FileSourceUnavailableError(this.root, error);
    }

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
