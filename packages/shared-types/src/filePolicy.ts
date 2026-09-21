/**
 * THE CANONICAL FILE POLICY — one implementation, two callers.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS LIVES IN A SHARED PACKAGE
 *
 * These rules used to live only in the consumer, next to the upload form. Then
 * Gmail attachments needed the same decisions — is this type allowed, how big
 * may it be, what do we tell someone we refused — and there were exactly two
 * options: import this, or restate it in the Brain.
 *
 * Restating it would have produced a second source of truth that drifts, and
 * the drift has a specific shape: an attachment accepted by email and refused
 * by upload, or worse the reverse. This file already carries the scars of that
 * failure — the picker once offered 48 extensions while storage accepted 27 —
 * so the answer was to move it, not to copy it.
 *
 * Consumer uploads and Brain Gmail ingestion call THIS. There is no other
 * implementation, and a change here changes both.
 *
 * ---------------------------------------------------------------------------
 * PURE BY CONSTRUCTION
 *
 * No I/O, no framework, no environment reads at module scope. Configuration
 * arrives through `resolveFilePolicy`, which is what lets a server process and
 * a browser bundle share the same decisions without sharing a runtime.
 */

/**
 * What MigraPilot can actually DO with a file.
 *
 * 🚨 THREE STATES, BECAUSE TWO WERE MADE TO MEAN THREE THINGS. `.xlsx` sat at
 * `unsupported` while a deterministic table reader for it existed and passed its
 * acceptance matrix — but flipping it to `indexed` would have claimed prose
 * retrieval the Brain cannot do over a zip container. One flag was being asked
 * to carry two independent questions, so the honest answer was neither value.
 *
 *  · `indexed`      — full ingestion: prose retrieval and search work.
 *  · `structured`   — accepted and analysed deterministically (tables, totals,
 *                     columns, sheets), but NOT indexed for prose retrieval.
 *  · `unsupported`  — cannot be meaningfully processed; refused with a reason.
 *
 * `structured` is named for the shape of the analysis, not for spreadsheets, so
 * it covers any machine-readable structured format without the enum having to
 * grow a synonym later.
 */
export type AttachmentSupport = 'indexed' | 'structured' | 'unsupported'

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
  kind: 'document' | 'data' | 'code' | 'image' | 'audio'
  /** Where a supported attachment is dispatched after classification. */
  pipeline?: AttachmentPipeline
  support: AttachmentSupport
  /**
   * Can this file be read as a table by the deterministic analysis layer?
   *
   * INDEPENDENT OF `support`, deliberately. A CSV is both indexed and
   * structurally analysable; an .xlsx is analysable and not indexed. Folding the
   * two into one string is what produced the state this type now avoids.
   */
  structured?: true
  /**
   * Is this format legitimately BINARY — a container the bytes of which are not
   * text, read by a real extractor?
   *
   * 🚨 DECLARED, NOT INFERRED. `contentMismatch` refuses a file whose bytes look
   * binary while its name claims a text type, and it used to decide which types
   * those were with a hardcoded `ext !== 'pdf' && ext !== 'docx'`. That is a
   * second list of what the table already knows, and it failed the moment a
   * third binary format shipped: making `.pptx` indexed silently enrolled it in
   * the must-be-plain-text check, so a genuine PowerPoint deck — a zip, like
   * every Office file — was rejected at upload as "a zip archive, not a .pptx
   * file". Declaring it here means the NEXT binary format is refused by omission
   * at review rather than at a user's upload.
   */
  binary?: true
  /**
   * What MigraPilot can and cannot do with it. Shown to the user, so it must be
   * true — for `unsupported` this is the refusal, and for `structured` it is the
   * boundary of what works.
   */
  reason?: string
}

const NO_EXTRACTOR =
  'MigraPilot cannot read this format yet — it would be stored without being understood.'
const SPREADSHEET_STRUCTURED =
  'Excel files can be analyzed as structured spreadsheet data — sheets, columns, ' +
  'labels and numeric values. General document-style text search inside ' +
  'spreadsheets is not available yet.'
const SPREADSHEET_OTHER =
  'MigraPilot reads .xlsx spreadsheets. Save this as .xlsx, or export the sheet as CSV.'
const ARCHIVE =
  'Archives are not opened yet. Attach the files inside it instead.'
const DUMP =
  'Database dumps are not accepted. Paste the part you want read, or attach it as a .txt file.'
/*
 * 🚨 A SPECIFIC REFUSAL IS NOT SUPPORT, AND MUST NOT READ LIKE IT.
 *
 * Audio was absent from this table entirely, so attaching an .mp3 produced the
 * generic "cannot read this format" — true, and useless. It reads as "this will
 * never work", when the real answer is "the thing that would read it is not
 * running yet". Those lead a person to opposite actions: one gives up, the other
 * asks when.
 *
 * This is a BETTER REFUSAL, not audio support. Recognising a format by name and
 * naming the missing dependency is honesty about a gap; it moves nothing toward
 * being able to read the file. Audio remains a MISSING CAPABILITY until a
 * Speech Runtime exists and Chat consumes it.
 */
const AUDIO_NO_RUNTIME =
  'MigraPilot recognises this as audio, but transcription is not configured yet, ' +
  'so there is nothing that can turn it into text. Attach a transcript if you have one.'

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
  { ext: 'pdf', kind: 'document', pipeline: 'document', support: 'indexed', binary: true },
  { ext: 'docx', kind: 'document', pipeline: 'document', support: 'indexed', binary: true },
  { ext: 'txt', kind: 'document', pipeline: 'document', support: 'indexed' },
  { ext: 'md', kind: 'document', pipeline: 'document', support: 'indexed' },
  { ext: 'markdown', kind: 'document', pipeline: 'document', support: 'indexed' },
  { ext: 'log', kind: 'document', pipeline: 'document', support: 'indexed' },

  // ── structured data read as text ──
  { ext: 'csv', kind: 'data', pipeline: 'document', support: 'indexed', structured: true },
  { ext: 'tsv', kind: 'data', pipeline: 'document', support: 'indexed', structured: true },
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
  { ext: 'xls', kind: 'data', support: 'unsupported', reason: SPREADSHEET_OTHER },
  /*
   * Accepted for deterministic table analysis only. The reader is bounded and
   * dependency-free, and everything the delimited lane proved — identifier
   * refusal, dates, ambiguity, the 90% bar — applies because a sheet becomes the
   * same ParsedTable a CSV becomes. What it is NOT is indexed: the Brain cannot
   * retrieve prose from a zip container, and saying otherwise would be the
   * capability lie this table exists to prevent.
   */
  { ext: 'xlsx', kind: 'data', pipeline: 'document', support: 'structured', structured: true, reason: SPREADSHEET_STRUCTURED },
  { ext: 'ods', kind: 'data', support: 'unsupported', reason: SPREADSHEET_OTHER },
  /*
   * ── audio: RECOGNISED BY NAME, REFUSED FOR A NAMED REASON ──
   *
   * Two workflows will eventually consume audio and they are NOT the same
   * feature: microphone capture turns speech into the user's own turn, while an
   * attached file is a persistent artifact that gets transcribed once and then
   * answered from, with provenance, like any other document. Neither exists yet.
   * Listing the formats here is what makes the refusal specific.
   */
  { ext: 'mp3', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'wav', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'm4a', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'aac', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'ogg', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'opus', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'flac', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'wma', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'aiff', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'amr', kind: 'audio', support: 'unsupported', reason: AUDIO_NO_RUNTIME },
  { ext: 'ppt', kind: 'document', support: 'unsupported', reason: NO_EXTRACTOR },
  /*
   * 🚨 A DECK IS NOT PROSE, AND IT IS NOT A WORKBOOK EITHER. It indexes like a
   * document because its content is text, but the retrievable unit is a SLIDE:
   * the extractor heads every slide with its number, so "which slide said that"
   * has the same kind of answer a PDF's page citation has.
   *
   * Charts and embedded worksheets are NOT read. The extractor reports that per
   * deck rather than letting a presentation whose figures live only in a chart
   * index as prose with the numbers quietly missing.
   */
  { ext: 'pptx', kind: 'document', pipeline: 'document', support: 'indexed', binary: true },
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

/**
 * Everything a person may actually attach — indexed OR structured.
 *
 * The picker offers THIS. Offering only indexed types would hide .xlsx behind a
 * menu that refuses it, which is the drift this file was written to end: the
 * product once listed 48 types and accepted 27.
 */
export const ATTACHABLE_EXTENSIONS: readonly string[] = ATTACHMENT_TYPES
  .filter((t) => t.support !== 'unsupported')
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
  .filter((t) => t.pipeline === 'document' && t.support !== 'unsupported')
  .map((t) => t.ext)
  .sort()

/**
 * Accepted, but analysed rather than indexed. Named so a caller can tell the
 * user what will actually happen instead of discovering it at question time.
 */
export const STRUCTURED_ONLY_EXTENSIONS: readonly string[] = ATTACHMENT_TYPES
  .filter((t) => t.support === 'structured')
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
export const DOCUMENT_PICKER_ACCEPT = ATTACHABLE_EXTENSIONS.map((e) => `.${e}`).join(',')

const BY_EXT = new Map(ATTACHMENT_TYPES.map((t) => [t.ext, t]))

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

/*
 * ── CAPABILITY QUESTIONS ───────────────────────────────────────────────────
 *
 * Downstream code asks what it can DO, never what the extension is. A single
 * support string forced every caller to re-derive the answer, and they drifted:
 * the picker offered types the store refused. Each question below has exactly
 * one definition.
 */

/** Can prose be retrieved and searched inside this file? */
export function canIndex(ext: string): boolean {
  return BY_EXT.get(ext)?.support === 'indexed'
}

/** Can the deterministic table layer read it — totals, columns, sheets? */
export function canAnalyzeStructurally(ext: string): boolean {
  const type = BY_EXT.get(ext)
  return Boolean(type?.structured) && type!.support !== 'unsupported'
}

/** May it be uploaded and kept at all? */
export function canAttach(ext: string): boolean {
  const support = BY_EXT.get(ext)?.support
  return support === 'indexed' || support === 'structured'
}

/** May it be sent to a vision model? */
export function canUseForVision(ext: string): boolean {
  const type = BY_EXT.get(ext)
  return type?.pipeline === 'image' && type.support === 'indexed'
}

/**
 * Retained as the name most call sites used. Prose retrieval is what "indexable"
 * always meant, and a structured file is emphatically not that.
 */
export function isIndexable(ext: string): boolean {
  return canIndex(ext)
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

/**
 * 🚨 THE TRANSPORT CEILING — ONE NUMBER, FOR THE WHOLE ROUTE.
 *
 * An upload crosses five things that can each refuse it by size: the browser
 * pre-check, nginx on VM102, this app's API route, the storage validator, and
 * the extractor. When they each carried their own number the product lied: the
 * app advertised 1024 MB while the proxy cut every request off at 32 MB, so a
 * 35 MB PDF died at a hop the app could not see and reported a network fault.
 *
 * THIS VALUE MUST NEVER EXCEED `client_max_body_size` ON THE PROXY. It is the
 * narrowest real transport limit, not an aspiration — everything downstream
 * derives from it, so raising it here without raising the proxy first would
 * reintroduce exactly that defect with a bigger number.
 *
 * The route it must agree with:
 *
 *     browser → pve 138.201.255.55:443 (DNAT, no body limit)
 *             → nginx VM102  chat.migrateck.com  client_max_body_size
 *             → consumer 10.10.0.13:3000  /api/files
 *             → storage MAX_FILE_BYTES → extractor MAX_EXTRACT_BYTES
 *
 * NOT THE PATH FOR LARGE MEDIA. Hundreds of megabytes to multiple gigabytes —
 * video especially — must not be carried by raising a proxied request body
 * toward 1 GB. A buffered body that size occupies proxy disk, cannot resume
 * after a dropped connection, and gives the user no progress they can trust.
 * That case wants direct/resumable upload to object storage with the app
 * issuing credentials and observing completion; see
 * `docs/migrapilot/large-media-uploads.md`.
 */
export const MAX_UPLOAD_MB = 256
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

/** The contract a UI renders from, so the displayed list cannot drift either. */
export function attachmentCapability() {
  return {
    accepted: ATTACHABLE_EXTENSIONS,
    /*
     * Named separately so a UI can say what will happen rather than implying
     * every accepted file is searchable.
     */
    structuredOnly: STRUCTURED_ONLY_EXTENSIONS,
    accept: DOCUMENT_PICKER_ACCEPT,
    maxUploadBytes: MAX_UPLOAD_BYTES,
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
    .filter((t) => t.support === 'indexed' && !t.binary)
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


/* ------------------------------------------------------------------ *
 * 🚨 The resolver — the only way to obtain an effective policy
 * ------------------------------------------------------------------ */

/**
 * The file pipeline's deployment configuration.
 *
 * Passed IN rather than read from `process.env` here, because this module is
 * also bundled for the browser — and a policy that silently read a different
 * environment in each caller would be the second source of truth this file
 * exists to prevent, wearing a single implementation's clothes.
 */
export interface FilePipelineConfig {
  /** `MIGRAPILOT_MAX_FILE_MB`. Anything unparseable falls back to the ceiling. */
  maxFileMb?: string | number | undefined;
}

/**
 * Whose policy this is.
 *
 * 🚨 REQUIRED, even though no rule varies by workspace TODAY. Making it
 * mandatory means a caller cannot resolve a policy without saying whose it is,
 * so the day a per-workspace ceiling or an allowlist override arrives it is
 * added HERE, once, rather than in whichever caller happened to need it first.
 *
 * Stating this plainly matters more than implying a scoping that does not yet
 * exist: today the returned policy is the same for every principal.
 */
export interface FilePolicyPrincipal {
  principalId: string;
  workspaceId: string;
}

/** What the ingestion path is allowed to do. The shape the bridge consumes. */
export interface FilePolicy {
  /** Lower-case, without the dot. */
  allowedExtensions: readonly string[];
  maxBytes: number;
}

/**
 * Megabytes to bytes, refusing nonsense.
 *
 * Moved here from the consumer's storage module so the ceiling is computed in
 * ONE place. A zero, a negative or a non-number falls back rather than
 * producing a limit of nothing, because a misconfigured variable must not
 * silently refuse every file.
 */
export function megabytesToBytes(value: string | number | undefined, fallbackMb: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1024 * 1024 : fallbackMb * 1024 * 1024;
}

/**
 * The effective policy for one principal, under one deployment configuration.
 *
 * 🚨 THE DOCUMENT PIPELINE'S LIST, not everything attachable. Images travel a
 * different store and are read by different machinery; handing the document
 * ingestion path an image allowlist is the mistake a test already caught once.
 */
export function resolveFilePolicy(input: {
  config: FilePipelineConfig;
  principal: FilePolicyPrincipal;
}): FilePolicy {
  // `principal` is intentionally unread today — see FilePolicyPrincipal.
  void input.principal;
  return {
    allowedExtensions: DOCUMENT_EXTENSIONS,
    maxBytes: megabytesToBytes(input.config.maxFileMb, MAX_UPLOAD_MB),
  };
}
