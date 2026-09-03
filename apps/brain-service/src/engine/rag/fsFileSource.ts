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
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Exclusions, DEFAULT_MIGRAAI_EXCLUSIONS } from './exclusions.js';
import { extractPdf, PdfExtractionError } from './pdfText.js';
import { extractDocx, DocxExtractionError } from './docxText.js';
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

/** SHA-256 of a file, streamed so a large PDF is never held in memory. */
async function sha256Of(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

/**
 * Does this sidecar describe the bytes currently on disk?
 *
 * A sidecar with NO recorded digest predates the field and is trusted: refusing
 * it would silently discard hours of completed OCR the moment this shipped. One
 * that DOES record a digest must match, and every new write records one — so the
 * exception closes itself as sidecars are rewritten.
 *
 * An unreadable file answers "no". Indexing text for something we cannot read is
 * exactly the mismatch this guards against.
 */
async function sidecarBelongsTo(
  sidecar: { sourceSha256?: string },
  filePath: string,
): Promise<boolean> {
  if (!sidecar.sourceSha256) return true;
  return (await sha256Of(filePath).catch(() => null)) === sidecar.sourceSha256;
}

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
     * 🚨 DO NOT RAISE THIS TO MATCH THE UPLOAD LIMIT. An earlier note here said
     * it must stay at least as large as the consumer's per-file limit; that was
     * written when the two numbers were close and it is now wrong. Uploads are
     * capped by TRANSPORT (256 MB); parsing is capped by THIS PROCESS, which
     * reads whole files into memory synchronously — matching them would let one
     * 256 MB document exhaust the Brain and end chat for every user.
     *
     * The gap is handled honestly instead of hidden: a file above this ceiling
     * is stored, named in the index route's `tooLargeToProcess`, and reported to
     * the user as too large to read — never as containing nothing readable.
     * Closing the gap needs streaming or worker-isolated extraction, not a
     * bigger constant.
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
          if (stat.size === 0) continue;

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
             *
             * 🚨 CHECKED BEFORE THE SIZE CEILING, AND THAT ORDER IS THE WHOLE
             * POINT. The ceiling exists to stop THIS walk loading a large file
             * into memory. A sidecar is a different, already-bounded artifact,
             * and its existence means the source was read out-of-band by the
             * background job. Skipping on the source's size first — which is
             * what this did — meant a 36 MB PDF could be OCR'd for two hours,
             * write a perfectly good sidecar, and then be passed over here: zero
             * chunks, and a terminal state of "the pages were read but nothing
             * could be indexed". The work happened and the user never saw it.
             */
            const sidecar = await fs
              .readFile(path.join(this.root, OCR_SIDECAR_DIR, `${childRel}.json`), 'utf8')
              .then((raw) => JSON.parse(raw) as {
                text?: string; pageStartLines?: number[]; sourceSha256?: string;
              })
              .catch(() => null);

            /*
             * 🚨 THE SIDECAR MUST BELONG TO THESE BYTES.
             *
             * It is named after the FILE, and a filename is not an identity.
             * Deleting `report.pdf` and uploading a completely different
             * `report.pdf` left the old sidecar in place, and this walk indexed
             * the PREVIOUS document's text under the new file — reported ready,
             * searchable, and citing a document that no longer exists. Observed
             * live: an altered copy of a 245-page book went to "Ready" in
             * seconds with no OCR, carrying the original's text.
             *
             * A sidecar written before this field existed has no digest. Those
             * are still trusted, because refusing them would silently discard
             * hours of completed OCR on upgrade — but a sidecar that DOES claim
             * a digest must match, and any future write records one.
             */
            if (sidecar?.text && await sidecarBelongsTo(sidecar, childAbs)) {
              out.push({
                relPath: childRel,
                content: sidecar.text,
                ...(sidecar.pageStartLines?.length ? { pageStartLines: sidecar.pageStartLines } : {}),
              });
              continue;
            }
          }

          /*
           * From here every path READS THE SOURCE FILE, so the ceiling applies.
           * A document above it is left to the background reader, which extracts
           * it a page at a time and leaves a sidecar the branch above will pick
           * up on the next sync.
           */
          if (stat.size > this.maxFileSize) continue;

          if (/\.pdf$/i.test(childRel)) {
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

          /*
           * A .docx is a ZIP of XML parts, so reading it as UTF-8 below would
           * index compressed bytes as though they were prose — a file in the
           * library that contributes nothing but looks indexed.
           *
           * Extracted inline like a text-layer PDF, because it is fast:
           * measured 14-122 ms on real documents, against minutes for OCR.
           * Nothing here needs the background job.
           */
          if (/\.docx$/i.test(childRel)) {
            try {
              const extracted = await extractDocx(new Uint8Array(await fs.readFile(childAbs)));
              if (extracted.text) out.push({ relPath: childRel, content: extracted.text });
            } catch (error) {
              // Skipped quietly for the same reason the PDF branch does: this
              // is a directory walk with no user to talk to. What must not
              // happen is indexing an unreadable document as if it held text.
              if (!(error instanceof DocxExtractionError)) throw error;
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
