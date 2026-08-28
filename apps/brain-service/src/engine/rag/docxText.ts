/**
 * Reading a Word document.
 *
 * A .docx is a ZIP of XML parts, so the bytes are meaningless to the indexer
 * until something walks them. Until now the upload list refused .docx for
 * exactly that reason: accepting a file that would index as garbage puts it in
 * the user's library while contributing nothing to any answer.
 *
 * WHY MAMMOTH (qualified 2026-08-27 against real documents, not chosen by
 * reputation):
 *
 *  - Measured against a zero-dependency baseline — unzip `word/document.xml`
 *    and strip tags — on four fixtures including two documents authored in real
 *    Word. The output was **byte-identical** every time (15,526 and 6,187
 *    characters among them). So the library buys no extra quality on ordinary
 *    documents, and the decision came down to what happens on documents nobody
 *    tested.
 *  - The baseline needs the `unzip` BINARY, which is **not installed on VM111**.
 *    Shipping it would mean a system package on production to avoid a 60 KB
 *    library that carries its own zip reader. That settles it.
 *  - BSD-2-Clause, pure JavaScript, no network calls, no child processes.
 *
 * `officeparser` was also measured and offered nothing the other two did not.
 *
 * WHAT THE LIBRARY DOES NOT DO, AND THIS MODULE THEREFORE DOES:
 *
 * 🚨 Mammoth reads the document BODY only. A footnote, an endnote, a header or
 * a footer lives in a different XML part, and all three candidates dropped them
 * silently — proven with a contract fixture whose footnote ("requires written
 * approval from the finance director") vanished from every extractor.
 *
 * Silently is the problem. A contract's obligations and a report's caveats live
 * in exactly those parts, and an assistant that answers from the body alone
 * would state a confident, incomplete answer. So the notes are recovered here
 * and appended under a labelled heading, which keeps them attributable rather
 * than blended into the body where they would look like ordinary prose.
 */

import JSZip from 'jszip';

export interface DocxExtraction {
  /** Body text, followed by any notes/headers recovered separately. */
  text: string;
  /** True when the document carried notes, headers or footers. */
  hasAuxiliaryText: boolean;
}

/** The document could not be read as a Word file at all. */
export class DocxExtractionError extends Error {
  readonly code = 'DOCX_UNREADABLE';
  constructor(reason: string, override readonly cause?: unknown) {
    super(reason);
    this.name = 'DocxExtractionError';
  }
}

/*
 * The parts mammoth does not read, in the order a reader would meet them.
 * Matched by prefix because Word numbers them: header1.xml, footnotes.xml, and
 * so on.
 */
const AUXILIARY_PARTS: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: 'word/footnotes.xml', label: 'Footnotes' },
  { prefix: 'word/endnotes.xml', label: 'Endnotes' },
  { prefix: 'word/header', label: 'Header' },
  { prefix: 'word/footer', label: 'Footer' },
];

/**
 * Plain text out of one OOXML part.
 *
 * Paragraph and tab boundaries are turned into real whitespace BEFORE tags are
 * stripped; doing it the other way round runs neighbouring paragraphs together
 * into a single unreadable line.
 */
function textFromPart(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Word's own separator/continuation notes, which are structural rather than
 * authored. They arrive as empty or single-character parts and would otherwise
 * appear to the user as a footnote that says nothing.
 */
const NOISE = /^[\s ]*$/;

/**
 * Extract readable text from a .docx.
 *
 * Throws {@link DocxExtractionError} when the bytes are not a Word document —
 * the caller decides what the user is told, because this layer has no user.
 */
export async function extractDocx(bytes: Uint8Array): Promise<DocxExtraction> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    throw new DocxExtractionError('the file is not a readable Word document', error);
  }

  if (!zip.file('word/document.xml')) {
    /*
     * A .doc renamed to .docx lands here, and so does a corrupt upload. Both are
     * worth distinguishing from "empty document": one is unreadable, the other
     * is readable and has nothing in it.
     */
    throw new DocxExtractionError('the file is not a Word document (no word/document.xml)');
  }

  let body = '';
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    body = String(result.value ?? '').trim();
  } catch (error) {
    throw new DocxExtractionError('the Word document could not be read', error);
  }

  const auxiliary: string[] = [];
  for (const { prefix, label } of AUXILIARY_PARTS) {
    // Sorted so header1 precedes header2 — the order they appear in the document.
    const parts = Object.keys(zip.files).filter((n) => n.startsWith(prefix)).sort();
    for (const name of parts) {
      const raw = await zip.file(name)?.async('string');
      if (!raw) continue;
      const text = textFromPart(raw);
      if (!text || NOISE.test(text)) continue;
      auxiliary.push(`[${label}] ${text}`);
    }
  }

  /*
   * Deduplicated because a header repeats on every page and Word stores one part
   * per section — three sections means the same sentence three times, which
   * would weight retrieval toward a running header over the document's actual
   * content.
   */
  const unique = [...new Set(auxiliary)];

  const text = unique.length > 0
    ? `${body}\n\nDocument notes, headers and footers:\n${unique.join('\n')}`
    : body;

  return { text: text.trim(), hasAuxiliaryText: unique.length > 0 };
}
