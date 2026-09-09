/**
 * EMAIL ATTACHMENT → THE CANONICAL FILE PIPELINE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THIS FILE PARSES NOTHING
 *
 * The obvious shortcut is an email-specific reader: pull the PDF out of the
 * message, extract its text, answer. It is the wrong shape, and it fails in a
 * way that compounds — the spreadsheet substrate already knows how to reason
 * about XLSX, refuse identifier arithmetic, disclose cached formula values and
 * enumerate a column. An email-only parser would have none of that, and every
 * improvement would then have to be made twice, in two places that slowly
 * disagree.
 *
 * So this converts an attachment into the SAME canonical file object an upload
 * produces, and hands it to the same pipeline. If it ever grows a parser, that
 * is the defect.
 *
 * ---------------------------------------------------------------------------
 * 🚨 PROVENANCE SURVIVES THE HANDOFF
 *
 * Once bytes enter the file pipeline they look like any other upload — which
 * is the point, and also the risk. A document answering "what does the Hetzner
 * invoice say" must still be traceable to the message it arrived in, or a
 * citation can only say "a file", and the user cannot tell which email it came
 * from or whether it is the one they meant.
 *
 * ---------------------------------------------------------------------------
 * WHY POLICY IS INJECTED
 *
 * Allowed types and size limits belong to the file pipeline, and it lives in
 * the consumer. Restating them here would create a second source of truth that
 * drifts — an attachment accepted by email and refused by upload, or worse the
 * reverse. The caller supplies the canonical policy.
 */

import type { EmailAttachmentEvidence } from './evidence.js';

/** The file pipeline's own rules, supplied by whoever owns them. */
export interface AttachmentPolicy {
  /** Lower-case, without the dot. The canonical upload list. */
  allowedExtensions: readonly string[];
  maxBytes: number;
}

/**
 * What the file pipeline receives. Deliberately the shape of an upload.
 *
 * A distinct "email file" type would fork every downstream rule; anything that
 * can read an uploaded document can read this without being taught about mail.
 */
export interface CanonicalFileHandoff {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  /**
   * Where it came from. Carried alongside rather than encoded into the
   * filename, so provenance is data a citation can read rather than a string
   * someone has to parse back out.
   */
  provenance: {
    source: 'email';
    providerMessageId: string;
    providerThreadId: string;
    providerAttachmentId: string;
    messageEvidenceId: string;
    attachmentEvidenceId: string;
  };
}

export type BridgeRefusal =
  | { kind: 'unsupported_type'; detail: string }
  | { kind: 'too_large'; limitBytes: number; actualBytes: number }
  | { kind: 'empty'; detail: string }
  | { kind: 'unreadable_name'; detail: string };

export type BridgeResult =
  | { ok: true; handoff: CanonicalFileHandoff }
  | { ok: false; refusal: BridgeRefusal };

/** The extension the pipeline will judge this by. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/**
 * Reduce a provider-supplied filename to something safe.
 *
 * Attachment names come from whoever sent the mail — an untrusted party by
 * definition. Separators are stripped structurally rather than blocked by
 * pattern, so `../../etc/passwd` becomes `etcpasswd` and cannot escape even in
 * principle. This mirrors the upload path's own rule for the same reason.
 */
export function safeAttachmentName(raw: string): string {
  const base = raw.replace(/[/\\]/g, '').replace(/^\.+/, '').trim();
  return base.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
}

/**
 * Convert one attachment into a canonical handoff, or refuse.
 *
 * Refusals are typed because they call for different things: an unsupported
 * type is permanent and worth saying plainly, an oversized file is about this
 * file, and a provider read failure — handled by the caller — is about us.
 */
export function bridgeAttachment(input: {
  evidence: EmailAttachmentEvidence;
  bytes: Uint8Array;
  policy: AttachmentPolicy;
}): BridgeResult {
  const { evidence, bytes, policy } = input;

  const filename = safeAttachmentName(evidence.filename);
  if (filename.length === 0 || filename === '.' || filename === '..') {
    return { ok: false, refusal: { kind: 'unreadable_name', detail: 'that attachment has no usable name' } };
  }

  const extension = extensionOf(filename);
  if (!extension || !policy.allowedExtensions.includes(extension)) {
    /*
     * Judged by EXTENSION, matching the upload path. A provider's declared MIME
     * type is a claim by the sender; the pipeline's own rule is the authority,
     * and using a different one here is how a file accepted by email gets
     * refused by upload.
     */
    return {
      ok: false,
      refusal: { kind: 'unsupported_type', detail: `${extension || 'that file type'} cannot be read` },
    };
  }

  if (bytes.byteLength === 0) {
    // Distinct from a read failure: the provider returned, and there was
    // nothing in it.
    return { ok: false, refusal: { kind: 'empty', detail: 'that attachment is empty' } };
  }

  if (bytes.byteLength > policy.maxBytes) {
    return {
      ok: false,
      refusal: { kind: 'too_large', limitBytes: policy.maxBytes, actualBytes: bytes.byteLength },
    };
  }

  return {
    ok: true,
    handoff: {
      filename,
      mimeType: evidence.mimeType,
      bytes,
      provenance: {
        source: 'email',
        providerMessageId: evidence.providerMessageId,
        providerThreadId: evidence.providerThreadId,
        providerAttachmentId: evidence.providerAttachmentId,
        messageEvidenceId: evidence.messageId,
        attachmentEvidenceId: evidence.id,
      },
    },
  };
}

/** What a user is told. Engine-owned, no provider vocabulary. */
export function bridgeRefusalMessage(refusal: BridgeRefusal): string {
  switch (refusal.kind) {
    case 'unsupported_type':
      return `That attachment cannot be read: ${refusal.detail}.`;
    case 'too_large':
      return 'That attachment is too large to read.';
    case 'empty':
      return 'That attachment is empty.';
    case 'unreadable_name':
      return 'That attachment could not be read.';
  }
}
