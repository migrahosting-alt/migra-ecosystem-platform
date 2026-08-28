/**
 * Filename handling for attachments — pure, so it can be tested against real filenames.
 *
 * 🚨 THE BUG THIS EXISTS TO PREVENT. The client pre-check extracted an extension WITH its
 * dot (`.json`) and compared it against the server's allowlist, which stores them WITHOUT
 * one (`json`). Every file that had an extension at all was therefore rejected before it
 * ever left the browser, with the message "That file type is not supported" — naming a type
 * the server would have accepted. The server was right the whole time; the mirror was wrong.
 *
 * Two implementations of the same rule will drift unless something forces them to agree, so
 * the tests compare this against the server's own `extensionOf` over real filenames rather
 * than checking either in isolation.
 */

/**
 * The extension WITHOUT its dot, lowercased — exactly what `server/files/storage.ts`
 * produces, because the values are compared against each other.
 *
 * A leading dot means a dotfile, not an extension: `.env` is a file named `.env`, and
 * treating it as an extension of `env` would let `.env` past a check meant to stop it.
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * The HTML `accept` attribute, which needs a LEADING DOT (`.json`) or a MIME type.
 *
 * The allowlist is stored bare, so handing it to `accept` unchanged produced
 * `accept="csv,conf,css,…"` — tokens the browser cannot interpret as extensions, which is
 * the same normalization mistake showing up in the file picker instead of the validator.
 */
export function acceptAttribute(allowedExtensions: readonly string[]): string {
  return allowedExtensions.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)).join(',')
}

/**
 * Types the DOCUMENT picker offers, which is deliberately WIDER than the set the
 * server currently accepts.
 *
 * WHY WIDER. "Files & documents" is a category the user already understands, and
 * a picker built only from today's supported extensions produces two bad
 * outcomes: the OS dialog reads as an arbitrary "Custom Files" list rather than
 * normal document selection, and a PDF — the single most common document there
 * is — appears to not exist rather than to be unsupported yet. Offering it and
 * then refusing it with a reason is the honest failure; hiding it is a silent one.
 *
 * The SERVER stays authoritative. Everything here that is not yet extractable is
 * refused after selection, with an explanation naming the format.
 */
/*
 * 🚨 MOVED. This list was written by hand beside a separately hand-written
 * storage allowlist, and they drifted until the picker offered 48 types and
 * storage accepted 27. Both now derive from one definition.
 *
 * Re-exported so existing imports keep working and nobody is tempted to write a
 * third list here.
 */
export { DOCUMENT_PICKER_ACCEPT } from './capability'

export interface FilenameRejection {
  code: 'unsupported_type' | 'too_large'
  message: string
}

/**
 * The client-side mirror of the server's rules.
 *
 * It exists only to save a round trip on an obvious rejection. The server stays
 * authoritative, so when this cannot decide it returns `null` and lets the upload proceed —
 * a mirror that guesses is worse than no mirror, as this file's own history shows.
 */
export function rejectionFor(
  file: { name: string; size: number },
  limits: { allowedExtensions: readonly string[]; maxFileBytes: number } | null,
): FilenameRejection | null {
  if (!limits) return null

  const extension = extensionOf(file.name)
  const allowed = new Set(limits.allowedExtensions.map((e) => (e.startsWith('.') ? e.slice(1) : e).toLowerCase()))

  if (!allowed.has(extension)) {
    return {
      code: 'unsupported_type',
      message: `${extension ? `.${extension}` : 'That file type'} is not supported. Allowed: ${limits.allowedExtensions
        .map((e) => (e.startsWith('.') ? e : `.${e}`))
        .join(', ')}.`,
    }
  }

  if (file.size > limits.maxFileBytes) {
    return {
      code: 'too_large',
      message: `Files are limited to ${Math.round(limits.maxFileBytes / 1024 / 1024)} MB.`,
    }
  }

  return null
}
