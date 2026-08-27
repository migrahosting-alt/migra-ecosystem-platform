/**
 * MigraAI Engine — filesystem file source for indexing.
 *
 * Walks a workspace root, applying {@link Exclusions} (secrets/binary/generated +
 * .gitignore + MigraAI list) and hard bounds (max files, max file size). Reads
 * text only; anything with NUL bytes is skipped. Never returns a whole repo's
 * worth of unbounded content.
 *
 * PDFs are the one exception to "text only": they are EXTRACTED rather than
 * read, and a PDF that cannot be extracted yields no chunks instead of yielding
 * garbage. See `pdfText.ts`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Exclusions, DEFAULT_MIGRAAI_EXCLUSIONS } from './exclusions.js';
import { extractPdf, PdfExtractionError } from './pdfText.js';
import { OCR_SIDECAR_DIR } from './scannedPdfJob.js';
import type { FileSource } from './indexService.js';

/** The root could not be read at all — distinct from a root that is empty. */
export class FileSourceUnavailableError extends Error {
  readonly code = 'SOURCE_UNAVAILABLE';
  constructor(readonly root: string, override readonly cause: unknown) {
    super(`Index root is unreadable: ${root}. This is NOT an empty library — nothing was read.`);
    this.name = 'FileSourceUnavailableError';
  }
}

/**
 * How much this process will PARSE, which is not how much may be stored.
 *
 * Extraction is synchronous and in-memory, so this ceiling protects the service
 * rather than the disk. It deliberately does NOT track the upload limit: a file
 * may be storable without being safe to parse here. The consumer reads the same
 * env var and default so the two can never disagree quietly — a silent
 * disagreement is what let a 500KB PDF be stored and never indexed.
 */
export const DEFAULT_MAX_INDEX_FILE_BYTES =
  (Number(process.env.MIGRAPILOT_MAX_EXTRACT_MB) || 25) * 1024 * 1024;

export class FsFileSource implements FileSource {
  constructor(
    private readonly root: string,
    private readonly maxFiles = 4000,
    /*
     * 🚨 THIS WAS 200KB AND IT SILENTLY DROPPED REAL DOCUMENTS.
     *
     * A file larger than this is skipped by the walk with no error anywhere: the
     * upload succeeds, the file sits in the library, and it contributes nothing
     * to any answer. That is the precise failure `uploadIndexerAgreement` exists
     * to prevent, and the agreement test could not see it because it compares
     * EXTENSIONS, not sizes — so a 500KB PDF passed every check and was still
     * never indexed.
     *
     * It must stay at least as large as the consumer's per-file limit, or the
     * two disagree again in exactly the same invisible way.
     */
    private readonly maxFileSize = DEFAULT_MAX_INDEX_FILE_BYTES,
  ) {}

  async files(): Promise<Array<{ relPath: string; content: string; pageStartLines?: number[] }>> {
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

  private async walk(
    abs: string,
    rel: string,
    excl: Exclusions,
    out: Array<{ relPath: string; content: string; pageStartLines?: number[] }>,
  ): Promise<void> {
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

          /*
           * A PDF NEVER takes the UTF-8 path.
           *
           * Reading one as text produces mojibake that chunks and indexes
           * perfectly happily, so the failure surfaces later as confident
           * nonsense in an answer rather than as a read error here. Extraction
           * is a different operation and is treated as one.
           */
          if (/\.pdf$/i.test(childRel)) {
            /*
             * A SCANNED PDF IS READ FROM ITS OCR SIDECAR, not re-read here.
             *
             * The background job already rasterised, recognised and reconstructed
             * it — nine minutes of work — and doing that again inside a sync would
             * block indexing for every other file. The sidecar holds the pages in
             * CANONICAL order with their boundaries, so these chunks get the same
             * page provenance a text-layer PDF gets.
             */
            const sidecar = await fs
              .readFile(path.join(this.root, OCR_SIDECAR_DIR, `${childRel}.json`), 'utf8')
              .then((raw) => JSON.parse(raw) as { text?: string; pageStartLines?: number[] })
              .catch(() => null);
            if (sidecar?.text) {
              out.push({
                relPath: childRel,
                content: sidecar.text,
                ...(sidecar.pageStartLines?.length ? { pageStartLines: sidecar.pageStartLines } : {}),
              });
              continue;
            }

            try {
              const extracted = await extractPdf(new Uint8Array(await fs.readFile(childAbs)));
              out.push({
                relPath: childRel,
                content: extracted.text,
                pageStartLines: extracted.pageStartLines,
              });
            } catch (error) {
              /*
               * Skipped, deliberately and quietly, because THIS layer has no
               * user to talk to — it is a directory walk. The honest message
               * belongs upstream where the upload happened, and the file simply
               * yields no chunks here. What must not happen is indexing a
               * scanned or damaged PDF as if it held text.
               */
              if (!(error instanceof PdfExtractionError)) throw error;
            }
            continue;
          }

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
