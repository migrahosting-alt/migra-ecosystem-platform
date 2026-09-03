/**
 * Reusing an extraction MigraPilot has already paid for.
 *
 * 🚨 WHY THIS EXISTS. `liv_kreyol_AI-Training.pdf` is a 245-page scanned book
 * with no text layer. Reading it costs roughly 1.5–2 hours of OCR. That work was
 * already done — 4.9 hours across the Kreyòl PASS 2 run — and uploading the same
 * file would have started it again from zero, because ingestion had no way to
 * recognise a document it had already read.
 *
 * IDENTITY IS THE HASH, NOT THE NAME. A filename is a label a user can change,
 * and two different books can share one. SHA-256 over the bytes is the only
 * claim strong enough to justify skipping the work: if the digest matches, the
 * pages are the same pages, and re-deriving them could only produce the same
 * answer more slowly.
 *
 * 🚨 REUSE MUST NOT PROMOTE TRUST. A registered extraction is `machine_extracted`
 * and `certified: false`, and it stays that way when reused. Recognising a
 * document is not the same as verifying it, and quietly upgrading its status on
 * the way through would launder a machine's guess into a human's confirmation.
 * The provenance records that the text was REUSED, and from where, so the claim
 * remains auditable rather than merely fast.
 */

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

/** Where registered extractions live. One file per artifact, named by digest. */
export const ARTIFACT_REGISTRY_DIR =
  process.env.MIGRAPILOT_ARTIFACT_REGISTRY ?? '/var/lib/migrapilot/artifacts';

export interface RegisteredPage {
  /** 1-based page number in the source document. */
  page: number;
  /**
   * The transcript EXACTLY as the original extraction produced it.
   *
   * Never normalised, for the reason the OCR path gives: this corpus mixes older
   * French-influenced Creole with the modern orthography, and rewriting either
   * destroys what the page says.
   */
  text: string;
}

export interface RegisteredArtifact {
  sha256: string;
  /** Where the extraction came from, e.g. a corpus source id like `HC-S009`. */
  sourceId: string;
  /** The filename at registration time. Descriptive only — never an identity. */
  sourceFile?: string;
  pages: RegisteredPage[];
  provenance: {
    engine: string;
    /** e.g. "hat+fra". Recorded because it bounds what the text can be trusted for. */
    langs?: string;
    dpi?: number;
    pass?: number;
    /**
     * 🚨 ALWAYS FALSE UNTIL A HUMAN SAYS OTHERWISE. Reuse copies this through
     * unchanged; nothing in this module may raise it.
     */
    certified: boolean;
  };
}

/** SHA-256 of a file, streamed so a large document is never held in memory. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

const DIGEST = /^[0-9a-f]{64}$/;

/**
 * The registered extraction for these exact bytes, if there is one.
 *
 * Returns null for anything unrecognised — an absent registry, an unreadable
 * entry, a digest that matches nothing. Reuse is an OPTIMISATION, and one that
 * fails must fall through to real ingestion rather than failing the document.
 */
export async function findRegisteredArtifact(
  sha256: string,
  dir: string = ARTIFACT_REGISTRY_DIR,
): Promise<RegisteredArtifact | null> {
  if (!DIGEST.test(sha256)) return null;
  try {
    // Named by digest, so the lookup is a single stat rather than a scan of
    // every registered artifact.
    const raw = await readFile(join(dir, `${sha256}.json`), 'utf8');
    const parsed = JSON.parse(raw) as RegisteredArtifact;

    /*
     * THE ENTRY MUST AGREE WITH THE FILE THAT NAMES IT. A record whose recorded
     * digest differs from its own filename is corrupt or tampered with, and
     * reusing it would attach one document's text to another document's bytes —
     * a far worse outcome than doing the OCR.
     */
    if (parsed?.sha256 !== sha256) return null;
    if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) return null;
    if (!parsed.provenance || typeof parsed.provenance.engine !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Registered digests, for reporting. Never used to decide a reuse. */
export async function listRegisteredArtifacts(
  dir: string = ARTIFACT_REGISTRY_DIR,
): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((name) => name.endsWith('.json') && DIGEST.test(name.slice(0, -5)))
      .map((name) => name.slice(0, -5));
  } catch {
    return [];
  }
}

/**
 * Provenance for text that was reused rather than freshly extracted.
 *
 * Deliberately verbose. Six months from now the question "where did this book's
 * text come from?" must be answerable from the record alone, and "OCR" would be
 * true but useless — it would not say that this run did no OCR at all.
 */
export function reuseProvenance(artifact: RegisteredArtifact): string {
  const p = artifact.provenance;
  const parts = [
    `reused from ${artifact.sourceId}`,
    `engine ${p.engine}`,
    ...(p.langs ? [`langs ${p.langs}`] : []),
    ...(p.dpi ? [`${p.dpi}dpi`] : []),
    ...(p.pass ? [`pass ${p.pass}`] : []),
    // Stated explicitly and last, because it is the part that limits the claim.
    `certified ${p.certified}`,
  ];
  return parts.join(', ');
}
