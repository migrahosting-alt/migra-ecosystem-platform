/**
 * PDF text extraction, with page provenance.
 *
 * A PDF is not a text file and must never reach the indexer through the UTF-8
 * reader — that path yields mojibake that indexes cleanly and answers wrongly,
 * which is worse than refusing the file.
 *
 * `unpdf` was chosen over `pdfjs-dist` and `pdf-parse` on measured evidence:
 * 2.6MB with zero dependencies and no native binary (proven to install and run on
 * the deploy target), it preserves table rows as lines, and — the deciding
 * property — it returns EXACTLY zero characters for an image-only page, so a
 * scanned document can be recognised as unreadable rather than silently indexed
 * as empty. `pdf-parse` emits synthetic page separators that defeat that check.
 * `pdfjs-dist` stays documented as the escalation path if column-accurate table
 * reconstruction is ever needed; it is deliberately NOT installed until a real
 * need justifies 68MB and a native canvas dependency.
 */

/** Why a PDF could not be turned into indexable text. Never a stack trace. */
export type PdfFailure =
  | { kind: 'encrypted' }
  | { kind: 'corrupt' }
  | { kind: 'no_text_layer'; pages: number }
  | { kind: 'unreadable'; detail: string }

export interface PdfPage {
  /** 1-based, as a human counts pages. */
  page: number
  text: string
}

export interface PdfExtraction {
  /** Flattened text for the model, with a blank line between pages. */
  text: string
  pages: PdfPage[]
  totalPages: number
  /**
   * Line offsets so a chunk's line range can be resolved back to a page.
   *
   * The model-facing text is flat, but a citation that says "page 7" is far more
   * natural than a line range invented for a format that has no lines. Keeping
   * the mapping at extraction time is the only place the information still
   * exists — once the text is chunked, the page boundaries are gone.
   */
  pageStartLines: number[]
}

/** A PDF that is present but cannot be answered from. */
export class PdfExtractionError extends Error {
  constructor(readonly failure: PdfFailure) {
    super(describe(failure))
    this.name = 'PdfExtractionError'
  }
}

export function describe(failure: PdfFailure): string {
  switch (failure.kind) {
    case 'encrypted':
      return 'This PDF is password-protected, so its text cannot be read.'
    case 'corrupt':
      return 'This PDF is damaged and could not be opened.'
    case 'no_text_layer':
      return 'This PDF has no readable text layer — it looks like a scan or images of pages.'
    default:
      return 'This PDF could not be read.'
  }
}

/**
 * Classify a thrown parser error WITHOUT guessing.
 *
 * The parser distinguishes these itself; the only job here is to avoid
 * collapsing them into one message. "Damaged" and "password-protected" call for
 * completely different actions from the user, and telling someone their intact
 * file is corrupt is its own kind of lie.
 */
function classify(error: unknown): PdfFailure {
  const name = (error as { name?: string })?.name ?? ''
  const message = String((error as { message?: string })?.message ?? error)
  if (name === 'PasswordException' || /password/i.test(message)) return { kind: 'encrypted' }
  if (name === 'InvalidPDFException' || /invalid pdf|structure/i.test(message)) return { kind: 'corrupt' }
  return { kind: 'unreadable', detail: message.slice(0, 200) }
}

/**
 * Extract text and page structure, or throw a CLASSIFIED failure.
 *
 * Never returns an empty string as if it were content: a PDF whose pages hold no
 * extractable characters is a distinct outcome with its own message, because
 * "the file is empty" and "this is a scan" lead the user somewhere different.
 */
export async function extractPdf(bytes: Uint8Array): Promise<PdfExtraction> {
  let pagesText: string[]
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const doc = await getDocumentProxy(bytes)
    const result = await extractText(doc, { mergePages: false })
    pagesText = (Array.isArray(result.text) ? result.text : [String(result.text)]).map(String)
  } catch (error) {
    throw new PdfExtractionError(classify(error))
  }

  const pages: PdfPage[] = pagesText.map((text, index) => ({ page: index + 1, text }))
  const meaningful = pages.filter((p) => p.text.trim().length > 0)
  if (meaningful.length === 0) {
    throw new PdfExtractionError({ kind: 'no_text_layer', pages: pages.length })
  }

  // Pages are joined with a blank line and their start lines recorded in the
  // same pass, so the mapping cannot drift from the text it describes.
  const pageStartLines: number[] = []
  let line = 1
  const parts: string[] = []
  for (const p of pages) {
    pageStartLines.push(line)
    const body = p.text.replace(/\r\n?/g, '\n')
    parts.push(body)
    line += body.split('\n').length + 1 // +1 for the blank separator line
  }

  return {
    text: parts.join('\n\n'),
    pages,
    totalPages: pages.length,
    pageStartLines,
  }
}

/** Which page a 1-based line of the flattened text came from. */
export function pageForLine(pageStartLines: readonly number[], line: number): number {
  let page = 1
  for (let i = 0; i < pageStartLines.length; i += 1) {
    if (line >= (pageStartLines[i] ?? 1)) page = i + 1
    else break
  }
  return page
}
