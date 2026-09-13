/**
 * What this deployment can actually read, asked of the service that reads.
 *
 * Mirrors `visionCapability.ts`, including the rule that matters most:
 *
 * 🚨 UNREACHABLE IS NOT UNAVAILABLE. If the Brain cannot be asked, this app does
 * not know — and reporting "the renderer is missing" would be as much an
 * invention as reporting that it is present. `unknown` lets the answer layer say
 * the honest thing, which is to fall back to what it can state without evidence.
 */

import { callBrain } from '@/server/brain/gateway'

export type SubCapabilityState = 'available' | 'unavailable' | 'unknown'

export interface DocumentReaderCapability {
  /** Extracting a PDF's existing text layer — in-process, no binaries. */
  pdfTextExtraction: SubCapabilityState
  /** Rasterising pages so they can be recognised — pdfinfo, pdftoppm. */
  pdfPageRendering: SubCapabilityState
  /** Recognising text in rendered pages — tesseract. */
  pdfOcr: SubCapabilityState
  /** The executables behind the above, for an operator reading an evidence record. */
  missing: string[]
}

interface Wire {
  subCapabilities?: {
    pdf_text_extraction?: string
    pdf_page_rendering?: string
    pdf_ocr?: string
  }
  dependencies?: { binary?: string; present?: boolean }[]
}

const state = (v: unknown): SubCapabilityState =>
  v === 'available' ? 'available' : v === 'unavailable' ? 'unavailable' : 'unknown'

/** Nothing known — every sub-capability `unknown`, and no claim about binaries. */
export const UNKNOWN_READER: DocumentReaderCapability = {
  pdfTextExtraction: 'unknown',
  pdfPageRendering: 'unknown',
  pdfOcr: 'unknown',
  missing: [],
}

export async function documentReaderCapability(): Promise<DocumentReaderCapability> {
  const result = await callBrain<Wire>({ kind: 'documentReaderCapability' })
  if (result.kind !== 'ok' || !result.value) return UNKNOWN_READER

  const subs = result.value.subCapabilities ?? {}
  return {
    pdfTextExtraction: state(subs.pdf_text_extraction),
    pdfPageRendering: state(subs.pdf_page_rendering),
    pdfOcr: state(subs.pdf_ocr),
    missing: (result.value.dependencies ?? [])
      .filter((d) => d && d.present === false && typeof d.binary === 'string')
      .map((d) => d.binary as string),
  }
}
