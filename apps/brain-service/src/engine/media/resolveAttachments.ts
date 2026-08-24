import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * Resolve opaque attachment refs into bytes the router may hand to a model.
 *
 * THE BROWSER NEVER SAYS WHERE ANYTHING LIVES. A turn carries `img_<32 hex>` and
 * nothing else; this resolves that through the Brain's OWN registered storage
 * state. There is no code path from a request field to a filesystem path, which
 * is the property the whole attachment design exists to preserve.
 *
 * EVERYTHING IS RE-CHECKED HERE, even though intake already checked it. Intake
 * validated what arrived; this validates what is about to reach a model, and
 * those are separated by time, by a filesystem, and by another service. A file
 * can be replaced under its record between the two. Re-sniffing, re-measuring and
 * re-hashing is what makes "this is the artifact the record describes" a fact at
 * the moment of use rather than a claim inherited from the past.
 *
 * IT DECIDES NOTHING ABOUT MEMORY. Which attachments are active for a turn is the
 * conversation layer's judgement — this resolves exactly the list it is given, in
 * the order given. Once conversations hold many images, documents, audio and
 * generated artifacts, "what is still in scope" is a policy question, and a
 * resolver that quietly answered it would be making that policy invisibly.
 */

export type AttachmentPurpose = 'subject' | 'reference';

export interface RequestedAttachment {
  ref: string;
  kind: 'image';
  purpose: AttachmentPurpose;
}

export type ResolveFailure =
  | 'not_found'
  | 'not_authorized'
  | 'corrupt'
  | 'type_mismatch'
  | 'too_large'
  | 'storage_unavailable'
  | 'invalid_ref'
  | 'duplicate_ref';

export interface ResolvedImage {
  ref: string;
  /** 1-based position in the order the user chose. */
  ordinal: number;
  purpose: AttachmentPurpose;
  mime: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  /**
   * A STABLE TOKEN THE ANSWER CAN CITE.
   *
   * Carried through routing so a response can say "this used image 1" and, later,
   * an evidence panel can show which artifact supported which claim. It is
   * derived from the ordinal and the content digest, so it identifies both WHICH
   * attachment in this turn and WHICH EXACT BYTES — a re-uploaded or altered
   * image produces a different token rather than silently inheriting the old
   * one's provenance.
   */
  provenance: string;
  /** The actual image. Never logged, never serialised into a record. */
  data: Buffer;
}

export interface ResolveRejection {
  ref: string;
  ordinal: number;
  reason: ResolveFailure;
  message: string;
}

export interface ResolveOutcome {
  resolved: ResolvedImage[];
  rejected: ResolveRejection[];
}

/** Metadata written beside the bytes at intake. */
interface StoredImageMeta {
  id: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  ownerScope: string;
}

export interface ResolverDeps {
  /**
   * The directory holding this scope's images, from the Brain's own registered
   * state — NOT recomputed from a scope string, and never taken from a request.
   * Returning null means the Brain has no registered storage for this scope,
   * which is `storage_unavailable`, not `not_found`: nothing was searched.
   */
  imageDirectoryFor(scope: string): Promise<string | null>;
  readFileImpl?: (path: string) => Promise<Buffer>;
}

const REF_PATTERN = /^img_[0-9a-f]{32}$/;

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Independent re-implementation, on purpose: this VERIFIES intake, so it must not import intake's answer. */
function sniff(data: Buffer): string | null {
  if (data.length < 12) return null;
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 4).equals(Buffer.from('GIF8'))) return 'image/gif';
  if (data.subarray(0, 4).equals(Buffer.from('RIFF')) && data.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'image/webp';
  return null;
}

function dimensionsOf(data: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png') {
    if (data.length < 24) return null;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (mime === 'image/gif') {
    if (data.length < 10) return null;
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset += 1; continue; }
      const marker = data[offset + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      const length = data.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }
  if (mime === 'image/webp') {
    if (data.length < 30) return null;
    const fourcc = data.subarray(12, 16).toString('ascii');
    if (fourcc === 'VP8X') {
      return {
        width: (data[24]! | (data[25]! << 8) | (data[26]! << 16)) + 1,
        height: (data[27]! | (data[28]! << 8) | (data[29]! << 16)) + 1,
      };
    }
    if (fourcc === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (fourcc === 'VP8L') {
      const bits = data.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/** Bounds re-applied at handoff, independent of whatever intake allowed. */
export const RESOLVER_MAX_BYTES = 8 * 1024 * 1024;
export const RESOLVER_MAX_DIMENSION = 12000;

export function provenanceTokenFor(ordinal: number, sha256: string): string {
  return `image:${ordinal}:sha256-${sha256.slice(0, 16)}`;
}

export async function resolveAttachments(
  scope: string,
  requested: readonly RequestedAttachment[],
  deps: ResolverDeps,
): Promise<ResolveOutcome> {
  const resolved: ResolvedImage[] = [];
  const rejected: ResolveRejection[] = [];
  if (requested.length === 0) return { resolved, rejected };

  const readImpl = deps.readFileImpl ?? ((path: string) => readFile(path));

  /*
   * The directory is asked for ONCE, from the Brain's registered state. If there
   * is none, every ref fails as `storage_unavailable` rather than `not_found` —
   * nothing was searched, and reporting "no such image" would be a claim about a
   * library that was never opened.
   */
  let directory: string | null = null;
  try {
    directory = await deps.imageDirectoryFor(scope);
  } catch {
    directory = null;
  }

  const seen = new Set<string>();

  for (const [index, item] of requested.entries()) {
    const ordinal = index + 1;
    const reject = (reason: ResolveFailure, message: string) =>
      rejected.push({ ref: String(item.ref), ordinal, reason, message });

    if (typeof item.ref !== 'string' || !REF_PATTERN.test(item.ref)) {
      reject('invalid_ref', 'That attachment reference is not valid.');
      continue;
    }
    /* Duplicates are refused exactly as the contract refuses them — two layers
     * disagreeing about the same rule is how one of them becomes decorative. */
    if (seen.has(item.ref)) {
      reject('duplicate_ref', 'That image is attached more than once.');
      continue;
    }
    seen.add(item.ref);

    if (!directory) {
      reject('storage_unavailable', 'Your images could not be reached right now.');
      continue;
    }

    let meta: StoredImageMeta;
    try {
      const raw = await readImpl(join(directory, `${item.ref}.meta.json`));
      meta = JSON.parse(raw.toString('utf8')) as StoredImageMeta;
    } catch {
      reject('not_found', 'That image is no longer available.');
      continue;
    }

    /*
     * OWNERSHIP IS RE-CHECKED AGAINST THE RECORD, not inferred from the fact that
     * the file was found in this directory. Directory membership is a property of
     * a filesystem that a move or a restore can get wrong; the record states who
     * owns it, and the two must agree before bytes are read.
     */
    if (meta.id !== item.ref) {
      reject('corrupt', 'That image record does not match its reference.');
      continue;
    }
    if (meta.ownerScope !== scope) {
      reject('not_authorized', 'That image belongs to another account.');
      continue;
    }

    const extension = MIME_EXTENSION[meta.mime];
    if (!extension) {
      reject('type_mismatch', 'That image type is not supported.');
      continue;
    }

    let data: Buffer;
    try {
      data = await readImpl(join(directory, `${item.ref}.${extension}`));
    } catch {
      reject('not_found', 'That image is no longer available.');
      continue;
    }

    /*
     * THE HASH IS THE IDENTITY. If the bytes changed under the record, this is no
     * longer the artifact the reference names — and answering about it while
     * citing that reference would attach the wrong provenance to the response.
     */
    const digest = createHash('sha256').update(data).digest('hex');
    if (digest !== meta.sha256) {
      reject('corrupt', 'That image could not be verified and was not used.');
      continue;
    }

    const sniffed = sniff(data);
    if (!sniffed || sniffed !== meta.mime) {
      reject('type_mismatch', 'That image could not be read as the type it claims to be.');
      continue;
    }

    if (data.byteLength > RESOLVER_MAX_BYTES) {
      reject('too_large', 'That image is too large to use in a message.');
      continue;
    }

    const dimensions = dimensionsOf(data, sniffed);
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
      reject('corrupt', 'That image could not be read.');
      continue;
    }
    if (dimensions.width > RESOLVER_MAX_DIMENSION || dimensions.height > RESOLVER_MAX_DIMENSION) {
      reject('too_large', 'That image is too large to use in a message.');
      continue;
    }

    resolved.push({
      ref: item.ref,
      ordinal,
      purpose: item.purpose === 'reference' ? 'reference' : 'subject',
      mime: sniffed,
      width: dimensions.width,
      height: dimensions.height,
      byteLength: data.byteLength,
      sha256: digest,
      provenance: provenanceTokenFor(ordinal, digest),
      data,
    });
  }

  return { resolved, rejected };
}

/**
 * What may be written to a log or an audit row.
 *
 * Explicit rather than "remember not to log `data`": the bytes are the one field
 * that must never leave this process, and a helper that cannot include them is
 * stronger than a convention that says not to.
 */
export function provenanceOf(image: ResolvedImage): Record<string, string | number> {
  return {
    ref: image.ref,
    ordinal: image.ordinal,
    purpose: image.purpose,
    mime: image.mime,
    width: image.width,
    height: image.height,
    byteLength: image.byteLength,
    sha256: image.sha256,
    provenance: image.provenance,
  };
}
