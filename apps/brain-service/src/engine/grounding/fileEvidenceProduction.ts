/**
 * A FILE BECOMES EVIDENCE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DIGEST IS COMPUTED HERE, FROM THE BYTES THAT WERE ACTUALLY READ
 *
 * Not taken from a caller, not carried down from a listing, not derived from
 * the name. A locator that anyone upstream could supply is a locator that can
 * be asserted rather than proven — and the whole point of an evidence id is
 * that a reader can go back to the same document and find the same thing.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A FILE THAT COULD NOT BE READ PRODUCES NO EVIDENCE AT ALL
 *
 * The tempting fallback is an item whose text is the FILENAME, so that
 * something lands in the ledger. It is worse than nothing: `budget-2026.xlsx`
 * contains the words "budget" and "2026", so a sentence like "the 2026 budget
 * was attached" would ground itself in a file nobody opened, and the caveat
 * attached to it — "based on part of the file" — describes reading part of
 * something rather than none of it.
 *
 * So extraction failures are reported to the caller as failures and the ledger
 * stays empty. "I could not open it" is an answer; a groundless claim is not.
 */

import { createHash } from 'node:crypto';

import type { EvidenceScope, FileEvidence } from './evidenceTypes.js';
import type { ExtractedFileText } from '../files/fileText.js';

export interface EvidenceIdSource {
  nextId(kind: 'file'): string;
}

export function fileEvidenceFrom(
  input: {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    extraction: ExtractedFileText;
    origin: FileEvidence['origin'];
  },
  scope: EvidenceScope,
  ids: EvidenceIdSource,
): FileEvidence {
  return {
    kind: 'file',
    id: ids.nextId('file'),
    scope,
    text: input.extraction.text,
    complete: input.extraction.complete,
    locator: {
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      filename: input.filename,
      mimeType: input.mimeType,
    },
    origin: input.origin,
  };
}

/**
 * Provenance for a file that arrived as a mail attachment.
 *
 * 🚨 THE PROVIDER'S ATTACHMENT ID IS DELIBERATELY NOT A PARAMETER, so it cannot
 * reach evidence even by accident. Gmail regenerates it on every `messages.get`
 * — a persisted copy names nothing an hour later, and a re-fetch handle that
 * has to be believed rather than checked is exactly the kind of pointer that
 * quietly becomes a permission. `attachmentRef` is ours, derived from the
 * attachment's own properties, and still resolves against a fresh read.
 */
export function emailAttachmentOrigin(input: {
  providerMessageId: string;
  providerThreadId: string;
  attachmentRef: string;
}): FileEvidence['origin'] {
  return {
    source: 'email-attachment',
    providerMessageId: input.providerMessageId,
    providerThreadId: input.providerThreadId,
    attachmentRef: input.attachmentRef,
  };
}
