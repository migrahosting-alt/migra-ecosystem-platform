/**
 * WHAT A FILE SAYS — one dispatcher, whatever the file arrived as.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE POLICY ALREADY PROMISED THIS AND NOTHING DELIVERED IT
 *
 * The canonical file policy has classified attachments into `indexed`,
 * `structured` and `unsupported` since the three-state model landed. It is the
 * authority the picker, the uploader and the mail bridge all consult, and it
 * says a .xlsx is ACCEPTED AND ANALYSED. `STRUCTURED_ONLY_EXTENSIONS` had no
 * consumer anywhere in the service — so a spreadsheet a user attached passed
 * every gate, arrived as bytes, and stopped. Accepted and unread.
 *
 * This is the consumer of that classification. It reads the same table rather
 * than keeping its own list of what it can open, because a dispatcher with its
 * own list is how the picker came to offer 48 extensions while storage accepted
 * 27.
 *
 * ---------------------------------------------------------------------------
 * 🚨 UNREADABLE IS NOT EMPTY
 *
 * Every failure here is REPORTED, never flattened into "no text". A scanned PDF,
 * a password-protected one, a .docx that is really a .doc, and a genuinely
 * blank document are four different facts that lead a user to four different
 * actions. Returning `''` for all of them produces an answer that says the file
 * contained nothing — confidently, about a file nobody could open.
 */

import {
  canAnalyzeStructurally, canIndex, extensionOf, refusalFor,
} from '@migrapilot/shared-types/file-policy';
import { readWorkbook, workbookText, WorkbookError } from '@migrapilot/shared-types/workbook';

import { extractDocx, DocxExtractionError } from '../rag/docxText.js';
import { extractPptx, PptxExtractionError } from '../rag/pptxText.js';
import { extractPdf, PdfExtractionError } from '../rag/pdfText.js';

export interface ExtractedFileText {
  text: string;
  /**
   * 🚨 Whether {@link text} is the WHOLE document.
   *
   * False for a workbook past the reader's cap. It travels to the evidence
   * layer, where it becomes the caveat on any answer — a truncated sheet must
   * never read as a whole one.
   */
  complete: boolean;
}

export type FileTextResult =
  | { ok: true; extraction: ExtractedFileText }
  /** We will not read this KIND of file. The policy's own words for the user. */
  | { ok: false; reason: 'unsupported'; detail: string }
  /** We would read it and could not. The extractor's own words for the user. */
  | { ok: false; reason: 'unreadable'; detail: string };

/**
 * Text is text — decoded, not extracted.
 *
 * These are the extensions the policy already calls `indexed` and that hold
 * plain characters. Listing them here rather than asking the policy for "is
 * this plain text" is deliberate: PDF and DOCX are indexed too, and they are
 * emphatically not decodable.
 */
const DECODABLE = new Set([
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml',
  'toml', 'ini', 'conf', 'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs',
  'java', 'c', 'h', 'cpp', 'cs', 'php', 'swift', 'kt', 'sh', 'html', 'css', 'scss',
]);

export async function extractFileText(input: {
  filename: string;
  bytes: Uint8Array;
}): Promise<FileTextResult> {
  const ext = extensionOf(input.filename);

  /*
   * 🚨 ASKED OF THE POLICY, NOT OF THIS MODULE'S OWN KNOWLEDGE. A file this
   * dispatcher cannot open but the policy accepts is a gap worth reporting as
   * one; a file the policy refuses is refused in the policy's words, so the
   * user is told the same thing here as at the picker.
   */
  if (!canIndex(ext) && !canAnalyzeStructurally(ext)) {
    return { ok: false, reason: 'unsupported', detail: refusalFor(input.filename) };
  }

  if (ext === 'xlsx') {
    try {
      const workbook = readWorkbook(Buffer.from(input.bytes));
      const rendered = workbookText(workbook.sheets);
      return { ok: true, extraction: { text: rendered.text, complete: rendered.complete } };
    } catch (error) {
      if (error instanceof WorkbookError) {
        return { ok: false, reason: 'unreadable', detail: error.message };
      }
      throw error;
    }
  }

  if (ext === 'pdf') {
    try {
      const extracted = await extractPdf(input.bytes);
      return { ok: true, extraction: { text: extracted.text, complete: true } };
    } catch (error) {
      if (error instanceof PdfExtractionError) {
        // A scan and a damaged file get different sentences; the error was
        // constructed with the one the extractor knows applies.
        return { ok: false, reason: 'unreadable', detail: error.message };
      }
      throw error;
    }
  }

  if (ext === 'docx') {
    try {
      const extracted = await extractDocx(input.bytes);
      return { ok: true, extraction: { text: extracted.text, complete: true } };
    } catch (error) {
      if (error instanceof DocxExtractionError) {
        return { ok: false, reason: 'unreadable', detail: error.message };
      }
      throw error;
    }
  }

  if (ext === 'pptx') {
    try {
      const extracted = await extractPptx(input.bytes);
      return { ok: true, extraction: { text: extracted.text, complete: true } };
    } catch (error) {
      if (error instanceof PptxExtractionError) {
        return { ok: false, reason: 'unreadable', detail: error.message };
      }
      throw error;
    }
  }

  if (DECODABLE.has(ext)) {
    /*
     * 🚨 FATAL DECODING. Bytes that are not valid UTF-8 are not text with a few
     * odd characters in it — they are a different file wearing a .txt name, and
     * the replacement characters a lenient decode produces would be indexed and
     * quoted as though someone had written them.
     */
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
      return { ok: true, extraction: { text, complete: true } };
    } catch {
      return { ok: false, reason: 'unreadable', detail: 'This file is not readable text.' };
    }
  }

  /*
   * The policy accepts it and this dispatcher has no reader — images, most
   * likely, which belong to the vision path and not to text extraction. Said
   * plainly rather than returning empty text, which would read as an empty file.
   */
  return {
    ok: false,
    reason: 'unsupported',
    detail: `There is no text reader for .${ext} files.`,
  };
}
