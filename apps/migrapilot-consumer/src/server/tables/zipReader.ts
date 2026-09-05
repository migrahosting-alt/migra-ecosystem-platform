import 'server-only'

import { inflateRawSync } from 'node:zlib'

/**
 * A bounded ZIP reader, for reading .xlsx workbooks.
 *
 * WHY NOT A LIBRARY. The deploy hardlinks `node_modules` from the previous
 * release and never installs, so a new runtime dependency is simply ABSENT in
 * production and the feature would crash there rather than fail here. On top of
 * that, the npm build of SheetJS carries two HIGH advisories (prototype
 * pollution and ReDoS) and this code parses files uploaded by strangers.
 * `jszip` exists in the local tree only because it is hoisted — it is not a
 * declared dependency, and relying on it is the clean-clone trap this repository
 * has already been caught by once.
 *
 * So this reads the small, regular subset a spreadsheet needs, and REFUSES
 * everything else. It is deliberately not a general ZIP implementation: no
 * encryption, no multi-disk archives, no ZIP64, no compression method except
 * store and deflate. An unsupported archive raises, and the caller treats that
 * the way it treats any unreadable table — the turn continues as ordinary
 * grounding rather than producing a confident number from a guess.
 *
 * EVERY BOUND IS CHECKED AGAINST THE BUFFER, not against a length the archive
 * claims. A crafted workbook that declares a 4 GB entry must fail on this side
 * of the allocation.
 */

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/** End of central directory record. */
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** A single stored entry. Names only; the bytes are read on demand. */
export interface ZipEntry {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

/**
 * Refuse anything larger than a spreadsheet has any business being once
 * expanded. A zip bomb's whole trick is a small archive that decompresses
 * without limit, so the limit is enforced on the DECLARED size before
 * decompression and on the RESULT after it.
 */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 4096

function readEocd(buffer: Buffer): { count: number; offset: number } {
  // The EOCD sits at the end, after a comment of unknown length, so it is found
  // by scanning backwards over the maximum comment size and no further.
  const maxComment = 0xffff
  const start = Math.max(0, buffer.length - maxComment - 22)
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      const count = buffer.readUInt16LE(i + 10)
      const offset = buffer.readUInt32LE(i + 16)
      if (offset >= buffer.length) throw new ZipError('central directory offset is outside the file')
      return { count, offset }
    }
  }
  throw new ZipError('not a zip archive: no end-of-central-directory record')
}

/** List the archive's entries from its central directory. */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22) throw new ZipError('file is too small to be a zip archive')
  const { count, offset } = readEocd(buffer)
  if (count > MAX_ENTRIES) throw new ZipError(`archive declares ${count} entries; refusing above ${MAX_ENTRIES}`)

  const entries: ZipEntry[] = []
  let p = offset
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buffer.length) throw new ZipError('central directory is truncated')
    if (buffer.readUInt32LE(p) !== CENTRAL_SIGNATURE) throw new ZipError('central directory entry is malformed')
    const compressionMethod = buffer.readUInt16LE(p + 10)
    const compressedSize = buffer.readUInt32LE(p + 20)
    const uncompressedSize = buffer.readUInt32LE(p + 24)
    const nameLength = buffer.readUInt16LE(p + 28)
    const extraLength = buffer.readUInt16LE(p + 30)
    const commentLength = buffer.readUInt16LE(p + 32)
    const localHeaderOffset = buffer.readUInt32LE(p + 42)
    const nameEnd = p + 46 + nameLength
    if (nameEnd > buffer.length) throw new ZipError('central directory entry name is truncated')
    // Latin-1 then decoded as UTF-8: entry names in xlsx are ASCII in practice,
    // and a name is only ever compared to a known path, never used as one.
    const name = buffer.subarray(p + 46, nameEnd).toString('utf8')
    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset })
    p = nameEnd + extraLength + commentLength
  }
  return entries
}

/**
 * Read one entry's bytes.
 *
 * The local header is re-read rather than trusting the central directory's name
 * and extra-field lengths, because the two can disagree and the local header is
 * what actually precedes the data.
 */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new ZipError(`entry ${entry.name} declares ${entry.uncompressedSize} bytes; refusing above ${MAX_ENTRY_BYTES}`)
  }
  const p = entry.localHeaderOffset
  if (p + 30 > buffer.length) throw new ZipError(`entry ${entry.name} has no local header`)
  if (buffer.readUInt32LE(p) !== LOCAL_SIGNATURE) throw new ZipError(`entry ${entry.name} local header is malformed`)
  const nameLength = buffer.readUInt16LE(p + 26)
  const extraLength = buffer.readUInt16LE(p + 28)
  const start = p + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > buffer.length) throw new ZipError(`entry ${entry.name} data is truncated`)
  const raw = buffer.subarray(start, end)

  if (entry.compressionMethod === 0) return Buffer.from(raw)
  if (entry.compressionMethod !== 8) {
    throw new ZipError(`entry ${entry.name} uses compression method ${entry.compressionMethod}, which is not supported`)
  }
  let out: Buffer
  try {
    // maxOutputLength makes the bomb protection structural rather than a check
    // we remember to perform after the fact.
    out = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES })
  } catch (error) {
    throw new ZipError(`entry ${entry.name} could not be decompressed: ${(error as Error).message}`)
  }
  if (out.length > MAX_ENTRY_BYTES) throw new ZipError(`entry ${entry.name} expanded beyond the limit`)
  return out
}

/** Read a named entry, or undefined when the archive has no such member. */
export function readNamedEntry(buffer: Buffer, name: string): Buffer | undefined {
  const entry = readZipEntries(buffer).find((e) => e.name === name)
  return entry ? readZipEntry(buffer, entry) : undefined
}

/** Does this look like a zip archive at all? Cheap, and checked before the rest. */
export function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === LOCAL_SIGNATURE
}
