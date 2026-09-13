/**
 * WHAT THIS SERVER CAN ACTUALLY READ, AS OPPOSED TO WHAT THE FORMAT LIST SAYS.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DEFECT THIS EXISTS FOR
 *
 * The product answered "Reading documents you attach — yes. PDF, CSV, JSON,
 * Markdown, plain text, code and .xlsx spreadsheets." from a HARD-CODED format
 * list and nothing else. On staging that sentence was half false: a PDF with a
 * text layer read fine, and a scanned PDF could not be read at all, because
 * `pdfinfo`, `pdftoppm` and `tesseract` are not installed on that host.
 *
 * Declared format support is not capability. Capability is
 *
 *     declared support  ∧  runtime dependencies  ∧  configuration/governance
 *
 * and only the first of those was being consulted.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE INVARIANT
 *
 * A capability must not be advertised as simply AVAILABLE when a material
 * sub-path required for common inputs is UNAVAILABLE. A scanned PDF is not an
 * exotic input; it is what "PDF" means to most people holding a document.
 *
 * So this reports SUB-CAPABILITIES rather than one boolean, and the answer
 * layer composes a sentence from them instead of reciting a constant.
 */

import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

export type SubCapabilityState = 'available' | 'unavailable';

/** One executable the reader shells out to, and what stops working without it. */
export interface ReaderDependency {
  binary: string;
  present: boolean;
  /** The sub-capabilities that cannot run without it. */
  required_by: string[];
}

export interface DocumentReaderCapability {
  /**
   * Keyed exactly as the answer layer consumes them. Names are part of the
   * contract: a caller must not have to infer which path a binary belongs to.
   */
  subCapabilities: {
    /** unpdf, in-process. A library, so it is present wherever the service is. */
    pdf_text_extraction: SubCapabilityState;
    /** pdftoppm/pdfinfo — rasterising pages so they can be recognised. */
    pdf_page_rendering: SubCapabilityState;
    /** tesseract — recognising text in those rendered pages. */
    pdf_ocr: SubCapabilityState;
  };
  dependencies: ReaderDependency[];
}

/**
 * Which sub-capability each executable gates.
 *
 * 🚨 `pdfinfo` GATES RENDERING, WHICH IS NOT OBVIOUS. `probePdfTextLayer` calls
 * `pdfPageCount` — which shells out to `pdfinfo` — as its very FIRST step, so
 * without it every PDF fails before its content is examined and falls through
 * to the scanned path. It is not merely a page counter; it is the gate in front
 * of the whole escalation route.
 */
const DEPENDENCIES: ReadonlyArray<{ binary: string; required_by: string[] }> = [
  { binary: 'pdfinfo', required_by: ['pdf_page_rendering'] },
  { binary: 'pdftoppm', required_by: ['pdf_page_rendering'] },
  { binary: 'tesseract', required_by: ['pdf_ocr'] },
];

/**
 * Is this executable on PATH?
 *
 * Resolved by looking, not by spawning. A probe that ran each binary would cost
 * three processes per health check and would report a DIFFERENT failure for a
 * binary that exists but exits non-zero — and "installed" is the fact being
 * asked for here.
 */
export function binaryOnPath(binary: string, path = process.env.PATH ?? ''): boolean {
  for (const dir of path.split(':')) {
    if (!dir) continue;
    try {
      accessSync(join(dir, binary), constants.X_OK);
      return true;
    } catch {
      // Not here. Keep looking — an unreadable directory on PATH is not an answer.
    }
  }
  return false;
}

/** What this host can read right now. Measured, never declared. */
export function documentReaderCapability(
  lookup: (binary: string) => boolean = (b) => binaryOnPath(b),
): DocumentReaderCapability {
  const dependencies: ReaderDependency[] = DEPENDENCIES.map((d) => ({
    binary: d.binary,
    present: lookup(d.binary),
    required_by: [...d.required_by],
  }));

  const satisfied = (sub: string): SubCapabilityState =>
    dependencies.filter((d) => d.required_by.includes(sub)).every((d) => d.present)
      ? 'available'
      : 'unavailable';

  return {
    subCapabilities: {
      // In-process, so it is available wherever this service is running at all.
      pdf_text_extraction: 'available',
      pdf_page_rendering: satisfied('pdf_page_rendering'),
      /*
       * 🚨 OCR WITHOUT RENDERING IS NOT OCR. tesseract reads IMAGES, and the
       * images come from pdftoppm. Reporting `pdf_ocr: available` on a host that
       * cannot rasterise a page would advertise a path that cannot be entered —
       * the exact shape of the defect this module exists to stop.
       */
      pdf_ocr: satisfied('pdf_ocr') === 'available' && satisfied('pdf_page_rendering') === 'available'
        ? 'available'
        : 'unavailable',
    },
    dependencies,
  };
}
