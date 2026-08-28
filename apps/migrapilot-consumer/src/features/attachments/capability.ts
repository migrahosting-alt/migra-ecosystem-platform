/**
 * What MigraPilot can be given, in one place.
 *
 * 🚨 THIS IS THE ONLY LIST. The picker, the upload validator, the refusal copy
 * and the accepted-types display all derive from it. They used to be separate
 * hand-maintained lists and they drifted exactly as separate lists do: the picker
 * offered 48 extensions while storage accepted 27, so a person could choose
 * `.xlsx` from a menu MigraPilot presented and be refused on upload — twenty-one
 * types deep. A single definition is the only thing that stops that returning.
 *
 * A TYPE IS SELECTABLE ONLY IF THE WHOLE PATH WORKS. Not "the bytes would
 * store" — an attachment that lands in the library and contributes nothing to an
 * answer is worse than one that was never offered, because the user believes it
 * was read.
 *
 * WHY SOME OBVIOUS TYPES ARE REFUSED
 *
 *  - Office binaries (.doc/.xls/.ppt and their Open Document cousins) have no
 *    extractor. The indexer does not even flag them as binary, so they would be
 *    read as UTF-8, produce nothing, and look accepted the whole time.
 *  - .xlsx and .pptx are refused DELIBERATELY rather than for want of a parser.
 *    Spreadsheet analysis is a known open defect — the model picks wrong maxima
 *    and mistranscribes figures — and shipping ingestion on top of that would
 *    advertise a capability that answers confidently and wrongly.
 *  - Archives are containers. Reading inside one is its own slice.
 *  - .sql is excluded by the indexer as a database dump, which is right for
 *    repository scanning and arguable for a deliberate upload. Left refused
 *    until that question is decided rather than quietly re-admitted.
 */

export type AttachmentSupport = 'indexed' | 'unsupported'

/**
 * Which canonical path an attachment travels once classified.
 *
 * 🚨 THE PICKER IS A SELECTION MECHANISM, NOT A CAPABILITY GATE. A JPEG chosen
 * through "Files" is an IMAGE, and it becomes one — it does not become an error
 * because of which menu entry opened the dialog. Action Hub entries are filters
 * over this one system; they never create a second universe with its own rules.
 */
export type AttachmentPipeline = 'image' | 'document'

export interface AttachmentType {
  ext: string
  /** Grouping for the picker and for what we tell people. */
  kind: 'document' | 'data' | 'code' | 'image'
  /** Where a supported attachment is dispatched after classification. */
  pipeline?: AttachmentPipeline
  support: AttachmentSupport
  /** Why it is refused. Shown to the user, so it must be true and useful. */
  reason?: string
}

const NO_EXTRACTOR =
  'MigraPilot cannot read this format yet — it would be stored without being understood.'
const SPREADSHEET_HELD =
  'Spreadsheet reading is not enabled yet. Export the sheet as CSV and MigraPilot can read it.'
const ARCHIVE =
  'Archives are not opened yet. Attach the files inside it instead.'
const DUMP =
  'Database dumps are not accepted. Paste the part you want read, or attach it as a .txt file.'

export const ATTACHMENT_TYPES: readonly AttachmentType[] = [
  /*
   * ── images ──
   * In the SAME table as documents, deliberately. They lived in a separate list
   * with a separate picker and a separate validator, which is why choosing a
   * PNG through Files produced ".png is not supported" beside a wall of
   * extensions — two universes, one of which had never heard of the other.
   */
  { ext: 'png', kind: 'image', pipeline: 'image', support: 'indexed' },
  { ext: 'jpg', kind: 'image', pipeline: 'image', support: 'indexed' },
  { ext: 'jpeg', kind: 'image', pipeline: 'image', support: 'indexed' },
  { ext: 'gif', kind: 'image', pipeline: 'image', support: 'indexed' },
  { ext: 'webp', kind: 'image', pipeline: 'image', support: 'indexed' },

  // ── documents that work end to end ──
  { ext: 'pdf', kind: 'document', pipeline: 'document', support: 'indexed' },
  { ext: 'docx', kind: 'document', pipeline: 'document', support: 'indexed' },
  { ext: 'txt', kind: 'document', pipeline: 'document', support: 'indexed' },
  { ext: 'md', kind: 'document', pipeline: 'document', support: 'indexed' },
  { ext: 'markdown', kind: 'document', pipeline: 'document', support: 'indexed' },
  { ext: 'log', kind: 'document', pipeline: 'document', support: 'indexed' },

  // ── structured data read as text ──
  { ext: 'csv', kind: 'data', pipeline: 'document', support: 'indexed' },
  { ext: 'tsv', kind: 'data', pipeline: 'document', support: 'indexed' },
  { ext: 'json', kind: 'data', pipeline: 'document', support: 'indexed' },
  { ext: 'xml', kind: 'data', pipeline: 'document', support: 'indexed' },
  { ext: 'yaml', kind: 'data', pipeline: 'document', support: 'indexed' },
  { ext: 'yml', kind: 'data', pipeline: 'document', support: 'indexed' },
  { ext: 'toml', kind: 'data', pipeline: 'document', support: 'indexed' },
  { ext: 'ini', kind: 'data', pipeline: 'document', support: 'indexed' },
  { ext: 'conf', kind: 'data', pipeline: 'document', support: 'indexed' },

  // ── source code, all plain text and genuinely indexed ──
  { ext: 'ts', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'tsx', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'js', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'jsx', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'py', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'rb', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'go', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'rs', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'java', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'c', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'h', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'cpp', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'cs', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'php', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'swift', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'kt', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'sh', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'html', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'css', kind: 'code', pipeline: 'document', support: 'indexed' },
  { ext: 'scss', kind: 'code', pipeline: 'document', support: 'indexed' },

  // ── refused, with the reason the user is told ──
  { ext: 'doc', kind: 'document', support: 'unsupported', reason: NO_EXTRACTOR },
  { ext: 'odt', kind: 'document', support: 'unsupported', reason: NO_EXTRACTOR },
  { ext: 'rtf', kind: 'document', support: 'unsupported', reason: NO_EXTRACTOR },
  { ext: 'xls', kind: 'data', support: 'unsupported', reason: SPREADSHEET_HELD },
  { ext: 'xlsx', kind: 'data', support: 'unsupported', reason: SPREADSHEET_HELD },
  { ext: 'ods', kind: 'data', support: 'unsupported', reason: SPREADSHEET_HELD },
  { ext: 'ppt', kind: 'document', support: 'unsupported', reason: NO_EXTRACTOR },
  { ext: 'pptx', kind: 'document', support: 'unsupported', reason: NO_EXTRACTOR },
  { ext: 'odp', kind: 'document', support: 'unsupported', reason: NO_EXTRACTOR },
  { ext: 'zip', kind: 'data', support: 'unsupported', reason: ARCHIVE },
  { ext: 'tar', kind: 'data', support: 'unsupported', reason: ARCHIVE },
  { ext: 'gz', kind: 'data', support: 'unsupported', reason: ARCHIVE },
  { ext: 'sql', kind: 'data', support: 'unsupported', reason: DUMP },
]

/** Everything selectable, across every pipeline. What the picker offers. */
export const INDEXED_EXTENSIONS: readonly string[] = ATTACHMENT_TYPES
  .filter((t) => t.support === 'indexed')
  .map((t) => t.ext)
  .sort()

/*
 * 🚨 EACH STORE TAKES ITS OWN PIPELINE, and this distinction is load-bearing.
 *
 * One contract does not mean one bucket. Images live in a content-addressed
 * image library and documents in the file library, and they are read by
 * different machinery. Deriving the DOCUMENT allowlist from everything
 * selectable made the document store accept a PNG — caught by a test that
 * already knew images are not documents.
 */
export const DOCUMENT_EXTENSIONS: readonly string[] = ATTACHMENT_TYPES
  .filter((t) => t.support === 'indexed' && t.pipeline === 'document')
  .map((t) => t.ext)
  .sort()

export const IMAGE_EXTENSIONS_CANONICAL: readonly string[] = ATTACHMENT_TYPES
  .filter((t) => t.support === 'indexed' && t.pipeline === 'image')
  .map((t) => t.ext)
  .sort()

/**
 * The picker's `accept`. Derived, never written by hand — a hand-written accept
 * string is precisely how the two lists came apart in the first place.
 *
 * Only selectable types appear. Offering an extension in order to explain the
 * refusal afterwards wastes the user's file-chooser trip.
 */
export const DOCUMENT_PICKER_ACCEPT = INDEXED_EXTENSIONS.map((e) => `.${e}`).join(',')

const BY_EXT = new Map(ATTACHMENT_TYPES.map((t) => [t.ext, t]))

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

export function isIndexable(ext: string): boolean {
  return BY_EXT.get(ext)?.support === 'indexed'
}

/**
 * Why this file is refused, in words for the person holding it.
 *
 * A known-but-unsupported type gets its specific reason; anything else gets the
 * general one. "MigraPilot cannot read .xlsx yet, export it as CSV" is
 * actionable; "unsupported file type" is not.
 */
export function refusalFor(fileName: string): string {
  const ext = extensionOf(fileName)
  const known = BY_EXT.get(ext)
  if (known?.reason) return known.reason
  return ext
    ? `MigraPilot cannot read .${ext} files. Attach a document, data file, or code file instead.`
    : 'That file has no extension, so MigraPilot cannot tell what it is.'
}

/** The contract a UI renders from, so the displayed list cannot drift either. */
export function attachmentCapability() {
  return {
    accepted: INDEXED_EXTENSIONS,
    accept: DOCUMENT_PICKER_ACCEPT,
    refused: ATTACHMENT_TYPES
      .filter((t) => t.support === 'unsupported')
      .map((t) => ({ ext: t.ext, reason: t.reason })),
  }
}


/**
 * Does this file's CONTENT match the kind of file its name claims to be?
 *
 * 🚨 THE EXTENSION IS A CLAIM, NOT EVIDENCE. Renaming `budget.xlsx` to
 * `budget.csv` passed validation and stored a zip archive as a text file — it
 * would then be read as UTF-8, hit its first NUL byte, be skipped by the
 * indexer, and sit in the library looking accepted while contributing nothing.
 * That is the same silent-discard failure the allowlist exists to prevent,
 * reached from the other direction.
 *
 * Only the text-shaped types are checked. PDF and DOCX are legitimately binary
 * and have real extractors; the point is not "reject binary" but "reject a
 * binary file wearing a text file's name".
 */
const BINARY_SIGNATURES: readonly { bytes: readonly number[]; label: string }[] = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: 'a zip archive (Office files are zips)' },
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], label: 'an older Office document' },
  { bytes: [0x25, 0x50, 0x44, 0x46], label: 'a PDF' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'a program' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], label: 'an image' },
  { bytes: [0xff, 0xd8, 0xff], label: 'an image' },
  { bytes: [0x1f, 0x8b], label: 'a gzip archive' },
]

/** Types whose bytes must actually be text. PDF/DOCX are excluded on purpose. */
const TEXT_SHAPED = new Set(
  ATTACHMENT_TYPES
    .filter((t) => t.support === 'indexed' && t.ext !== 'pdf' && t.ext !== 'docx')
    .map((t) => t.ext),
)

export function contentMismatch(fileName: string, head: Uint8Array): string | null {
  const ext = extensionOf(fileName)
  if (!TEXT_SHAPED.has(ext)) return null

  for (const sig of BINARY_SIGNATURES) {
    if (sig.bytes.every((b, i) => head[i] === b)) {
      return `This looks like ${sig.label}, not a .${ext} file. `
        + 'Rename it to its real extension, or export it as text first.'
    }
  }
  // A NUL byte in the first block is the general signal: text files do not
  // contain them, and the indexer skips anything that does — so accepting it
  // would store a file nothing can read.
  if (head.subarray(0, 512).includes(0)) {
    return `That .${ext} file contains binary data, so MigraPilot cannot read it as text.`
  }
  return null
}


// ── classification ──────────────────────────────────────────────────────────

/**
 * What this attachment IS, and where it goes.
 *
 * 🚨 CLASSIFY, THEN DISPATCH. The old design decided validity at the picker: a
 * JPEG selected through "Files" was refused as an unsupported document, because
 * the menu entry had already decided what kind of thing you were allowed to be
 * holding. The picker now only selects; this decides.
 *
 * Three sources of evidence, in increasing order of authority:
 *   extension — what the file is NAMED. A claim.
 *   MIME      — what the browser GUESSED, usually from the same extension.
 *   bytes     — what it actually IS.
 *
 * The extension chooses the pipeline, because that is what the user meant. The
 * bytes are then required to agree, which is what stops a zip wearing a .csv
 * name from being stored as text and silently skipped by the indexer.
 */
export type Classification =
  | { ok: true; pipeline: AttachmentPipeline; ext: string }
  | { ok: false; message: string }

const IMAGE_SIGNATURES: readonly { bytes: readonly number[]; ext: string }[] = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], ext: 'png' },
  { bytes: [0xff, 0xd8, 0xff], ext: 'jpg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], ext: 'gif' },
  // WEBP is RIFF....WEBP — the container is checked, then the form at byte 8.
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp' },
]

function looksLikeImage(head: Uint8Array): boolean {
  return IMAGE_SIGNATURES.some((s) => s.bytes.every((b, i) => head[i] === b))
}

export function classifyAttachment(
  fileName: string,
  declaredMime: string | undefined,
  head: Uint8Array,
): Classification {
  const ext = extensionOf(fileName)
  const known = BY_EXT.get(ext)

  // A type we know and have decided against keeps its specific reason.
  if (known?.support === 'unsupported') return { ok: false, message: known.reason ?? refusalFor(fileName) }

  /*
   * An unknown extension is not automatically hopeless. If the BYTES are an
   * image, the user is holding a photo whatever it is called, and refusing it on
   * a name would be pedantry — but the name must not actively contradict a
   * different supported type.
   */
  if (!known) {
    if (looksLikeImage(head) && (declaredMime ?? '').startsWith('image/')) {
      return { ok: true, pipeline: 'image', ext: 'png' }
    }
    return { ok: false, message: refusalFor(fileName) }
  }

  const pipeline = known.pipeline ?? 'document'

  if (pipeline === 'image') {
    // Named as an image; the bytes have to be one. Otherwise it is a document
    // (or something worse) wearing a photo's name.
    if (head.length >= 4 && !looksLikeImage(head)) {
      return { ok: false, message: `That .${ext} file is not a real image, so MigraPilot cannot open it.` }
    }
    return { ok: true, pipeline: 'image', ext }
  }

  // Document pipeline: the existing content rule already refuses a binary file
  // wearing a text file's name, and PDF/DOCX are exempt because they are
  // legitimately binary and have real extractors.
  const mismatch = contentMismatch(fileName, head)
  if (mismatch) return { ok: false, message: mismatch }
  return { ok: true, pipeline: 'document', ext }
}

/**
 * The `accept` for the GENERAL attach entry.
 *
 * Every supported type, images included, so one control reaches everything
 * MigraPilot can actually use. The specialised Action Hub entries narrow this
 * for convenience; none of them narrows what the SYSTEM will accept.
 */
export const ALL_SUPPORTED_ACCEPT = INDEXED_EXTENSIONS.map((e) => `.${e}`).join(',')

/** Just the images, for the "Photos" shortcut. A filter, not a different rule. */
export const IMAGE_ACCEPT = ATTACHMENT_TYPES
  .filter((t) => t.pipeline === 'image')
  .map((t) => `.${t.ext}`)
  .join(',')
