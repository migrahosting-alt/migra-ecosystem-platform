/**
 * Reconstruct a book's canonical order from OCR evidence, not from scan order.
 *
 * The scan of this Haitian Creole book proves why the distinction is not
 * academic: every image holds TWO physical pages, and within each spread the
 * RIGHT page is EARLIER than the left. Scan 12 carries folio 33 on the right and
 * later sections on the left; scan 13 carries the CHAPIT 2 opening on the right
 * and folio 39 — content from inside that chapter — on the left. Reading spreads
 * left-to-right, or trusting upload order, produces a confidently wrong book.
 *
 * So position on the sheet is recorded as a FACT and used only as a last resort.
 * Order is inferred from what the pages say about themselves, and where the
 * evidence runs out the pages are marked uncertain rather than forced into a
 * sequence that would look authoritative and be invented.
 */

import type { ScannedPageRecord } from './scannedOcr.js';

export type PlacementState =
  | 'confirmed'
  | 'probable'
  | 'sequence_uncertain'
  | 'duplicate'
  | 'missing_neighbor';

/** Which evidence actually decided this page's position. */
export type PlacementBasis =
  | 'printed_folio'
  | 'section_number'
  | 'chapter_range'
  | 'continuation'
  | 'scan_order';

export interface PlacedPage {
  scanIndex: number;
  physicalPosition: ScannedPageRecord['physicalPosition'];
  /** Inferred position in the book, 1-based. Undefined when unplaceable. */
  canonicalIndex?: number;
  /** The printed page number, when one was recovered and trusted. */
  folio?: number;
  state: PlacementState;
  basis: PlacementBasis;
  /** Human-readable justification, kept so a wrong order can be argued with. */
  evidence: string;
  sections: string[];
  chapterMarkers: string[];
  confidence: number;
  /** Exact OCR output. NEVER normalised — see `searchText` for the derived form. */
  sourceText: string;
  /**
   * Derived, lossy, and strictly additional.
   *
   * Retrieval benefits from collapsed whitespace and folded diacritics; the
   * transcript must not, because this book mixes older French-influenced Creole
   * with the modern orthography and rewriting either would destroy what the page
   * actually says. Two fields, never one.
   */
  searchText: string;
}

export interface DeclaredRange {
  chapter: string;
  from: number;
  to: number;
  source: string;
}

export interface DocumentMap {
  pages: PlacedPage[];
  declaredRanges: DeclaredRange[];
  /** Violations of the book's own declarations — reasons NOT to trust the order. */
  validationFailures: string[];
  /** Folios the sequence implies should exist but no page claims. */
  missingFolios: number[];
  summary: { confirmed: number; probable: number; uncertain: number; duplicates: number };
}

/**
 * A chapter page that states which sections it contains.
 *
 * The book supplies this itself — "Mo ki soti nan franse # 29 rive # 40" — which
 * is far stronger than any heuristic, because it is the document's own account
 * of its structure and can be used to CONTRADICT an inferred order.
 */
export function parseDeclaredRanges(text: string, chapter: string): DeclaredRange[] {
  const ranges: DeclaredRange[] = [];
  // "# 29 rive # 40" (from ... to) and "# 68 ak 70" (this one and that one).
  const pattern = /#\s*(\d{1,3})\s*(?:rive|a|à|ak)\s*#?\s*(\d{1,3})/gi;
  for (const m of text.matchAll(pattern)) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
      ranges.push({ chapter, from, to, source: m[0].trim() });
    }
  }
  return ranges;
}

/** The leading integer of a section marker: "27.1-" -> 27. */
function sectionNumber(marker: string): number | undefined {
  const m = /^(\d{1,3})/.exec(marker.trim());
  return m ? Number(m[1]) : undefined;
}

/**
 * A folio is trusted only when the page offers exactly one candidate.
 *
 * Two standalone numbers on a page means one of them is a section number, a
 * year, or a table cell — and guessing which would put the page in a confidently
 * wrong place. Ambiguity here should cost the page its folio, not its honesty.
 */
function trustedFolio(record: ScannedPageRecord): number | undefined {
  const plausible = record.folioCandidates.filter((n) => n > 0 && n < 1000);
  return plausible.length === 1 ? plausible[0] : undefined;
}

/** Normalised only for retrieval. Never written back over the transcript. */
export function toSearchText(source: string): string {
  return source
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // fold diacritics for matching only
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Cheap near-duplicate signal: same folio, or near-identical transcript. */
function duplicateKey(record: ScannedPageRecord): string {
  const head = toSearchText(record.selectedText).slice(0, 120);
  return head.length >= 40 ? head : '';
}

export function reconstructDocument(records: readonly ScannedPageRecord[]): DocumentMap {
  const declaredRanges: DeclaredRange[] = [];
  for (const r of records) {
    for (const chapter of r.chapterMarkers) {
      declaredRanges.push(...parseDeclaredRanges(r.selectedText, chapter));
    }
  }

  const seen = new Map<string, number>();
  const folioSeen = new Map<number, number>();
  const placed: PlacedPage[] = [];

  for (const record of records) {
    // A blank half is not part of the book's sequence and must not consume a
    // position in it — it is an artefact of how the sheet was photographed.
    if (record.layout === 'blank' || record.selectedText.trim().length === 0) continue;

    const folio = trustedFolio(record);
    const sectionNumbers = record.sectionCandidates.map(sectionNumber).filter((n): n is number => n !== undefined);
    const key = duplicateKey(record);

    let state: PlacementState;
    let basis: PlacementBasis;
    let evidence: string;
    let canonicalIndex: number | undefined;

    if (folio !== undefined && folioSeen.has(folio)) {
      /*
       * TWO PAGES CANNOT BOTH BE FOLIO 33.
       *
       * The first run placed scan 2 and scan 22 both at folio 7, and scan 12 and
       * scan 23 both at 33, while transcript-prefix matching caught only one
       * duplicate in the whole book — OCR noise in the opening words is enough to
       * make two captures of the same page look different. A folio collision is
       * the stronger signal and is checked first.
       */
      state = 'duplicate';
      basis = 'printed_folio';
      evidence = `folio ${folio} already claimed by scan ${folioSeen.get(folio)}`;
    } else if (key && seen.has(key)) {
      state = 'duplicate';
      basis = 'scan_order';
      evidence = `transcript opening matches scan ${seen.get(key)}`;
    } else if (folio !== undefined) {
      state = 'confirmed';
      basis = 'printed_folio';
      canonicalIndex = folio;
      evidence = `printed folio ${folio}`;
    } else if (sectionNumbers.length > 0) {
      /*
       * No folio, but the page names its own sections. That places it relative to
       * the book's numbering even though it cannot claim an exact page — which is
       * "probable", not "confirmed", and the difference is the point.
       */
      state = 'probable';
      basis = 'section_number';
      evidence = `sections ${record.sectionCandidates.join(', ')} without a readable folio`;
    } else if (record.chapterMarkers.length > 0) {
      state = 'probable';
      basis = 'chapter_range';
      evidence = `chapter marker ${record.chapterMarkers.join(', ')}`;
    } else {
      /*
       * Nothing on the page says where it belongs. Scan order COULD be used, and
       * for this book scan order is demonstrably wrong, so the page is marked
       * uncertain instead of being given a position it cannot support.
       */
      state = 'sequence_uncertain';
      basis = 'scan_order';
      evidence = 'no folio, section or chapter evidence on this page';
    }

    if (key && !seen.has(key)) seen.set(key, record.scanIndex);
    if (folio !== undefined && !folioSeen.has(folio)) folioSeen.set(folio, record.scanIndex);

    placed.push({
      scanIndex: record.scanIndex,
      physicalPosition: record.physicalPosition,
      ...(canonicalIndex !== undefined ? { canonicalIndex } : {}),
      ...(folio !== undefined ? { folio } : {}),
      state,
      basis,
      evidence,
      sections: record.sectionCandidates,
      chapterMarkers: record.chapterMarkers,
      confidence: record.confidence,
      sourceText: record.selectedText,
      searchText: toSearchText(record.selectedText),
    });
  }

  /*
   * A CHAPTER OPENING IS PLACED BY WHAT IT DECLARES, not left to the end.
   *
   * The first full run produced ten validation failures that were entirely my
   * own artefact: the CHAPIT 2 opening carries no folio, so it sorted after every
   * folio-bearing page, and the validator then correctly observed that sections
   * 29-40 appeared BEFORE their own chapter opening. The evidence was fine; the
   * ordering was not.
   *
   * A chapter that declares it holds sections 29-40 belongs immediately before
   * the first page carrying one of them. The half-step keeps it ahead of that
   * page without claiming a folio it never printed.
   */
  const folioOfSection = new Map<number, number>();
  for (const page of placed) {
    if (page.folio === undefined) continue;
    for (const marker of page.sections) {
      const n = sectionNumber(marker);
      if (n !== undefined && !folioOfSection.has(n)) folioOfSection.set(n, page.folio);
    }
  }
  for (const page of placed) {
    if (page.canonicalIndex !== undefined || page.chapterMarkers.length === 0) continue;
    const mine = declaredRanges.filter((r) => page.chapterMarkers.includes(r.chapter));
    const anchors = mine
      .map((r) => {
        for (let s = r.from; s <= r.to; s += 1) {
          const f = folioOfSection.get(s);
          if (f !== undefined) return f;
        }
        return undefined;
      })
      .filter((f): f is number => f !== undefined);
    if (anchors.length > 0) {
      page.canonicalIndex = Math.min(...anchors) - 0.5;
      page.basis = 'chapter_range';
      page.evidence = `declares sections ${mine[0]!.from}-${mine[0]!.to}; anchored before folio ${Math.min(...anchors)}`;
    }
  }

  // Confirmed pages sort by folio; everything else keeps its discovery order
  // AFTER them, because an unplaceable page must not push a placed one around.
  placed.sort((a, b) => {
    if (a.canonicalIndex !== undefined && b.canonicalIndex !== undefined) return a.canonicalIndex - b.canonicalIndex;
    if (a.canonicalIndex !== undefined) return -1;
    if (b.canonicalIndex !== undefined) return 1;
    return a.scanIndex - b.scanIndex;
  });

  const validationFailures = validateAgainstDeclarations(placed, declaredRanges);

  const folios = placed.map((p) => p.folio).filter((n): n is number => n !== undefined).sort((a, b) => a - b);

  /*
   * A ONE-PAGE GAP IS THE NORMAL CASE HERE, not a missing page.
   *
   * The first full run marked EVERY page `missing_neighbor` and left `confirmed`
   * at zero — because the recovered folios are 7, 11, 15, 17, 19, 21, 23, 25 …
   * all odd. This book was photographed one readable side per sheet, so only
   * rectos carry folios and consecutive captured pages differ by two. Treating
   * that as a hole reported the entire book as damaged.
   *
   * The stride is therefore MEASURED from the folios themselves rather than
   * assumed to be 1, and only a gap wider than the book's own rhythm counts as a
   * genuine absence.
   */
  const deltas = folios.slice(1).map((n, i) => n - folios[i]!).filter((d) => d > 0);
  const stride = deltas.length > 0
    ? [...deltas].sort((a, b) => deltas.filter((v) => v === a).length - deltas.filter((v) => v === b).length).pop()!
    : 1;

  const missingFolios: number[] = [];
  for (let i = 1; i < folios.length; i += 1) {
    const gap = folios[i]! - folios[i - 1]!;
    if (gap > stride) {
      for (let f = folios[i - 1]! + stride; f < folios[i]!; f += stride) missingFolios.push(f);
    }
  }
  for (const page of placed) {
    if (page.state === 'confirmed' && page.folio !== undefined
        && (missingFolios.includes(page.folio - stride) || missingFolios.includes(page.folio + stride))) {
      page.state = 'missing_neighbor';
    }
  }

  return {
    pages: placed,
    declaredRanges,
    validationFailures,
    missingFolios,
    summary: {
      confirmed: placed.filter((p) => p.state === 'confirmed').length,
      probable: placed.filter((p) => p.state === 'probable').length,
      uncertain: placed.filter((p) => p.state === 'sequence_uncertain').length,
      duplicates: placed.filter((p) => p.state === 'duplicate').length,
    },
  };
}

/**
 * Check the inferred order against what the book SAYS about itself.
 *
 * Validation runs in both directions on purpose. If a chapter declares it holds
 * sections 29-40, a sequence placing section 39 before that chapter's opening is
 * wrong however confident the scan indices look — the document's own declaration
 * outranks an inference drawn from page positions.
 */
export function validateAgainstDeclarations(
  pages: readonly PlacedPage[],
  ranges: readonly DeclaredRange[],
): string[] {
  const failures: string[] = [];
  for (const range of ranges) {
    const opening = pages.findIndex((p) => p.chapterMarkers.includes(range.chapter));
    if (opening === -1) continue;
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i]!;
      const numbers = page.sections.map(sectionNumber).filter((n): n is number => n !== undefined);
      const inRange = numbers.filter((n) => n >= range.from && n <= range.to);
      if (inRange.length > 0 && i < opening) {
        failures.push(
          `${range.chapter} declares sections ${range.from}-${range.to} (${range.source}), but scan ` +
          `${page.scanIndex}/${page.physicalPosition} carries section ${inRange[0]} BEFORE the chapter opening`,
        );
      }
    }
  }
  return failures;
}
