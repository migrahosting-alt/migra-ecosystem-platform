/**
 * Turning an already-known extraction into an indexable document.
 *
 * This is the cheapest of the three ingestion paths and the only one that does
 * no reading at all: the pages already exist, registered under the source's
 * SHA-256, so the work is to present them in the shape the indexer expects.
 * Seconds instead of two hours, for a document whose text we already have.
 *
 * 🚨 IT DOES NOT UPGRADE ANYTHING. The registered pages are `machine_extracted`
 * with `certified: false`, and they come out the same way. Recognising a
 * document is not verifying it. The evidence string records that this run reused
 * a prior extraction and names its source, so a later reader can tell the
 * difference between text this system produced and text it inherited.
 */

import type { RegisteredArtifact } from './artifactReuse.js';
import { reuseProvenance } from './artifactReuse.js';
import { toSearchText, type DocumentMap, type PlacedPage } from './documentMap.js';
import type { DocumentReadiness } from './documentReadiness.js';

export interface ReusedArtifactJobDeps {
  report(readiness: DocumentReadiness): Promise<void>;
  now?(): number;
}

export interface ReusedArtifactJobResult {
  map: DocumentMap;
  pageCount: number;
  sourceId: string;
}

function placedFromRegistered(
  page: { page: number; text: string },
  artifact: RegisteredArtifact,
): PlacedPage {
  return {
    scanIndex: page.page,
    physicalPosition: 'single',
    canonicalIndex: page.page,
    state: 'confirmed',
    basis: 'file_page_order',
    // Names the origin, so provenance survives into the map and the sidecar.
    evidence: `page ${page.page}, ${reuseProvenance(artifact)}`,
    sections: [],
    chapterMarkers: [],
    /*
     * NOT 1. A text-layer PDF's order is certain because the file states it;
     * this order is inherited from an extraction whose own confidence varied
     * page by page. Claiming certainty we did not measure would be exactly the
     * promotion of trust this path must not perform.
     */
    confidence: 0.9,
    sourceText: page.text,
    indexAction: 'index',
    alternateCaptures: [],
    searchText: toSearchText(page.text),
  };
}

/**
 * Present a registered artifact as a document map.
 *
 * Pages with no text are DROPPED rather than indexed empty — the same rule the
 * other paths follow — but they are counted, so the terminal state can say the
 * sequence is incomplete rather than silently shortening the book.
 */
export async function processRegisteredArtifact(
  artifact: RegisteredArtifact,
  fileName: string,
  deps: ReusedArtifactJobDeps,
): Promise<ReusedArtifactJobResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();

  await deps.report({
    fileName,
    state: 'processing',
    stage: 'matching_known_source',
    startedAt,
    detail: `reusing ${artifact.pages.length} pages from ${artifact.sourceId}`,
    pagesTotal: artifact.pages.length,
    pagesDone: 0,
  });

  const usable = artifact.pages
    .filter((p) => p.text.trim().length > 0)
    .sort((a, b) => a.page - b.page)
    .map((p) => placedFromRegistered(p, artifact));

  return {
    map: {
      pages: usable,
      declaredRanges: [],
      validationFailures: [],
      missingFolios: [],
      summary: { confirmed: usable.length, probable: 0, uncertain: 0, duplicates: 0 },
    },
    pageCount: artifact.pages.length,
    sourceId: artifact.sourceId,
  };
}

/** The terminal readiness a reuse implies. */
export function readinessFromReuse(
  fileName: string,
  result: ReusedArtifactJobResult,
  startedAt: number,
): DocumentReadiness {
  const readable = result.map.pages.length;
  if (readable === 0) {
    /*
     * A registered artifact holding no usable text is a broken registry entry,
     * not a broken document. Reported as a failure so it is visible rather than
     * silently producing an empty book — and the next upload will simply run
     * real ingestion.
     */
    return {
      fileName,
      state: 'ocr_failed',
      startedAt,
      failureReason: `the stored extraction for ${result.sourceId} contained no readable pages`,
    };
  }

  return {
    fileName,
    state: 'ready',
    stage: 'ready',
    orderedPages: readable,
    unplacedPages: 0,
    sequenceComplete: readable === result.pageCount,
    startedAt,
  };
}
