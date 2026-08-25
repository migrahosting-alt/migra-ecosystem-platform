import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { requireSession } from '@/server/auth'
import { deriveBrainScope } from '@/server/tenancy/ownerScope'
import { downscaleForModel, MODEL_IMAGE_MAX_EDGE } from './downscale'
import { acceptImage, isImageId, type AcceptedImage, type ImageMime } from './images'

/**
 * Per-user image storage.
 *
 * A SEPARATE ROOT FROM THE TEXT LIBRARY, ON PURPOSE. The uploads directory IS the
 * interface to the Brain's RAG indexer — the consumer writes there and the Brain
 * indexes that same path. The Brain's exclusion list already treats png/jpeg/gif/
 * webp as binary, so an image sitting there would be skipped today; but that is a
 * property of a list in another service that could reasonably change. Keeping
 * images out of the indexed tree entirely makes "binary never enters the text
 * chunk path" structural rather than a promise maintained in two repositories.
 *
 * It also gives images their own quota. Sharing the text library's budget would
 * mean one photo evicting a user's documents, which is not a trade anyone asked
 * for.
 *
 * TENANCY IS DERIVED, NEVER PASSED. The directory comes from the verified session
 * and nothing else, using the SAME bucket derivation as the text library so both
 * belong to one recognisable owner.
 */

const imageRoot = (): string => process.env.IMAGE_ROOT ?? '/var/lib/migrapilot/images'

/** Images are bounded independently of documents. */
export const MAX_IMAGE_LIBRARY_BYTES = 200 * 1024 * 1024
export const MAX_IMAGES = 100

export interface StoredImage {
  id: string
  mime: ImageMime
  bytes: number
  width: number
  height: number
  sha256: string
  createdAt: number
  /** What the user called it. Display only — it never decides where bytes land. */
  displayName: string
  /** The scope that owns it, recorded so provenance survives a directory move. */
  ownerScope: string
  /**
   * Hash of the cached copy prepared for the model, when one exists.
   *
   * ITS PRESENCE IS THE CACHE INDEX and its value is the integrity check, for
   * the same reason the original carries `sha256`: a derived file that changed
   * underneath its record would put a different picture in front of the model
   * than the one the user is looking at, and an answer about the wrong image is
   * worse than a slow answer about the right one. Absent on images stored before
   * the cache existed, which simply derive on first use.
   */
  modelSha256?: string
  /** Size of that copy, so a trace can show what the resize actually bought. */
  modelBytes?: number
}

export class ImageRejected extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ImageRejected'
  }
}

async function imageDirectory(): Promise<{ dir: string; owner: string }> {
  const session = await requireSession()
  const scope = deriveBrainScope(session)
  const bucket = createHash('sha256').update(scope.owner).digest('hex').slice(0, 32)
  const dir = join(imageRoot(), bucket)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return { dir, owner: scope.owner }
}

/** Metadata lives beside the bytes, named from the same canonical id. */
const metaPathFor = (dir: string, id: string) => join(dir, `${id}.meta.json`)

const extensionFor = (mime: ImageMime) => (mime === 'image/jpeg' ? 'jpg' : mime.replace('image/', ''))

/**
 * Where the model's copy lives.
 *
 * THE CAP IS IN THE NAME so that changing `MODEL_IMAGE_MAX_EDGE` invalidates
 * every cached copy by construction. A cache keyed on an id alone would keep
 * serving 1024px images long after someone decided the cap should be 1568, and
 * the stale ones would be indistinguishable from correct ones.
 */
const modelPathFor = (dir: string, id: string, mime: ImageMime) =>
  join(dir, `${id}.model-${MODEL_IMAGE_MAX_EDGE}.${extensionFor(mime)}`)

/** Atomic like every other write here: a reader never sees a half-written file. */
async function writeAtomic(dir: string, target: string, bytes: Buffer): Promise<void> {
  const temp = join(dir, `.tmp-${randomUUID()}`)
  try {
    await writeFile(temp, bytes, { mode: 0o600 })
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

async function readMeta(dir: string, id: string): Promise<StoredImage | null> {
  try {
    const raw = await readFile(metaPathFor(dir, id), 'utf8')
    const parsed = JSON.parse(raw) as StoredImage
    return parsed.id === id ? parsed : null
  } catch {
    return null
  }
}

export async function listImages(): Promise<StoredImage[]> {
  const { dir } = await imageDirectory()
  const entries = await readdir(dir).catch(() => [] as string[])
  const images: StoredImage[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue
    const meta = await readMeta(dir, entry.slice(0, -'.meta.json'.length))
    if (meta) images.push(meta)
  }
  return images.sort((a, b) => b.createdAt - a.createdAt)
}

async function libraryBytes(images: StoredImage[]): Promise<number> {
  return images.reduce((total, image) => total + image.bytes, 0)
}

/**
 * Store an image, or say why not.
 *
 * ATOMIC. Bytes are written to a unique temporary name in the SAME directory and
 * then renamed into place — rename within one filesystem is atomic, so a reader
 * never observes a half-written image, and a crash mid-write leaves a temp file
 * rather than a corrupt one under a canonical id. Every failure path removes its
 * own temporary, so a rejected upload leaves nothing behind.
 *
 * DE-DUPLICATION IS FREE because ids are content-addressed: re-uploading the same
 * photo resolves to the same id, and the existing record is returned rather than
 * a second copy written.
 */
export async function saveImage(rawName: string, data: ArrayBuffer): Promise<StoredImage> {
  const bytes = new Uint8Array(data)
  const decision = acceptImage(rawName, bytes)
  if (!decision.ok) throw new ImageRejected(decision.rejection.code, decision.rejection.message)

  const image: AcceptedImage = decision.image
  const { dir, owner } = await imageDirectory()

  const existing = await readMeta(dir, image.id)
  if (existing) return existing

  const current = await listImages()
  if (current.length >= MAX_IMAGES) {
    throw new ImageRejected('too_many_images', `You can keep up to ${MAX_IMAGES} images. Delete one to add another.`)
  }
  if ((await libraryBytes(current)) + image.bytes > MAX_IMAGE_LIBRARY_BYTES) {
    throw new ImageRejected(
      'library_full',
      `Your images use more than ${MAX_IMAGE_LIBRARY_BYTES / 1024 / 1024} MB. Delete some to add more.`,
    )
  }

  const finalPath = join(dir, image.storedName)
  const tempPath = join(dir, `.tmp-${randomUUID()}`)
  const meta: StoredImage = {
    id: image.id,
    mime: image.mime,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    sha256: image.sha256,
    createdAt: Date.now(),
    displayName: rawName.slice(0, 200),
    ownerScope: owner,
  }

  try {
    await writeFile(tempPath, bytes, { mode: 0o600 })
    await rename(tempPath, finalPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }

  /*
   * The model's copy is derived HERE, not on the chat turn.
   *
   * Downscaling a 12MP photo costs about 1.8s of pure-JavaScript decode on this
   * hardware. Paid during upload it is hidden behind the user still typing their
   * question; paid on the turn it is 1.8s added to every answer about that image,
   * for ever. Content-addressed ids make the result permanently valid: a given id
   * is a given set of bytes, so this is derived once and never recomputed.
   *
   * A FAILURE HERE IS NOT AN UPLOAD FAILURE. Without `modelSha256` the turn simply
   * derives it on demand — slower, and still correct. The image itself is already
   * safely stored by this point and must not be lost to a cache problem.
   */
  try {
    const forModel = downscaleForModel(Buffer.from(bytes), image.mime, image.width, image.height)
    if (!forModel.original) {
      await writeAtomic(dir, modelPathFor(dir, image.id, image.mime), forModel.bytes)
      meta.modelSha256 = createHash('sha256').update(forModel.bytes).digest('hex')
      meta.modelBytes = forModel.bytes.byteLength
    }
  } catch {
    // Deliberately swallowed: see above.
  }

  try {
    const metaTemp = join(dir, `.tmp-${randomUUID()}`)
    await writeFile(metaTemp, JSON.stringify(meta), { mode: 0o600 })
    await rename(metaTemp, metaPathFor(dir, image.id))
  } catch (error) {
    /*
     * Bytes without metadata is an image nothing can describe or authorize, so
     * the partial artifact is removed rather than left to be discovered later as
     * an untracked file in someone's namespace.
     */
    await rm(finalPath, { force: true })
    throw error
  }

  return meta
}

/** Bytes for a stored image, or null. Shape-checked before any path is built. */
export async function readImageBytes(id: string): Promise<{ meta: StoredImage; bytes: Buffer } | null> {
  if (!isImageId(id)) return null
  const { dir } = await imageDirectory()
  const meta = await readMeta(dir, id)
  if (!meta) return null

  const bytes = await readFile(join(dir, `${id}.${extensionFor(meta.mime)}`)).catch(() => null)
  if (!bytes) return null

  /*
   * The stored hash is re-checked on read. A mismatch means the file changed
   * underneath its metadata, and serving it as the image the record describes
   * would attach the wrong provenance to whatever a model then says about it.
   */
  if (createHash('sha256').update(bytes).digest('hex') !== meta.sha256) return null

  return { meta, bytes }
}

/**
 * The copy a vision model should be handed.
 *
 * WHY THIS IS NOT `readImageBytes`. What the library stores and what the model
 * reads are two different artifacts with two different jobs. The library keeps
 * the user's real picture at full resolution, because that is what they uploaded
 * and what the transcript shows. The model gets a bounded copy, because prefill
 * cost scales with image tokens and a full-resolution photo turned a two-second
 * answer into a twenty-eight-second one. Keeping them separate is what lets both
 * be right.
 *
 * THE CACHED COPY IS VERIFIED, not trusted. It is derived data living in a
 * directory, and if it no longer matches the hash recorded when it was derived
 * then it is not the picture this record describes — so it is discarded and
 * rebuilt from the original, which is itself hash-checked on the way through.
 */
export async function readModelImage(
  id: string,
): Promise<{ meta: StoredImage; bytes: Buffer; downscaled: boolean; fromCache: boolean } | null> {
  if (!isImageId(id)) return null
  const { dir } = await imageDirectory()
  const meta = await readMeta(dir, id)
  if (!meta) return null

  if (meta.modelSha256) {
    const cached = await readFile(modelPathFor(dir, id, meta.mime)).catch(() => null)
    if (cached && createHash('sha256').update(cached).digest('hex') === meta.modelSha256) {
      return { meta, bytes: cached, downscaled: true, fromCache: true }
    }
  }

  // Cold: an image stored before this cache existed, a failed warm, or a copy
  // that no longer verifies. Derive from the original and leave it warm.
  const original = await readImageBytes(id)
  if (!original) return null

  const forModel = downscaleForModel(original.bytes, meta.mime, meta.width, meta.height)
  if (!forModel.original) {
    try {
      await writeAtomic(dir, modelPathFor(dir, id, meta.mime), forModel.bytes)
      const next: StoredImage = {
        ...meta,
        modelSha256: createHash('sha256').update(forModel.bytes).digest('hex'),
        modelBytes: forModel.bytes.byteLength,
      }
      await writeAtomic(dir, metaPathFor(dir, id), Buffer.from(JSON.stringify(next)))
    } catch {
      // The answer does not depend on the cache being written.
    }
  }

  return { meta, bytes: forModel.bytes, downscaled: !forModel.original, fromCache: false }
}

/**
 * Delete an image and its record.
 *
 * SEMANTICS: this removes it from the LIBRARY. Detaching an image from one
 * conversation is a different act handled by the conversation, and conflating
 * them would make "remove this from the message" quietly destroy an image used
 * elsewhere.
 */
export async function deleteImage(id: string): Promise<boolean> {
  if (!isImageId(id)) return false
  const { dir } = await imageDirectory()
  const meta = await readMeta(dir, id)
  if (!meta) return false

  await rm(join(dir, `${id}.${extensionFor(meta.mime)}`), { force: true })
  // The derived copy goes with it. Leaving it behind would keep a picture of a
  // deleted image on disk, which is not what "delete" means to the person asking.
  await rm(modelPathFor(dir, id, meta.mime), { force: true })
  await rm(metaPathFor(dir, id), { force: true })
  return true
}

/** Total usage, for a library view that can show a real number. */
export async function imageUsage(): Promise<{ count: number; bytes: number; maxBytes: number; maxCount: number }> {
  const images = await listImages()
  return {
    count: images.length,
    bytes: await libraryBytes(images),
    maxBytes: MAX_IMAGE_LIBRARY_BYTES,
    maxCount: MAX_IMAGES,
  }
}

/** Present so a stray temp file from a crashed write cannot accumulate forever. */
export async function sweepTemporaries(olderThanMs = 60 * 60 * 1000): Promise<number> {
  const { dir } = await imageDirectory()
  const entries = await readdir(dir).catch(() => [] as string[])
  let removed = 0
  for (const entry of entries) {
    if (!entry.startsWith('.tmp-')) continue
    const info = await stat(join(dir, entry)).catch(() => null)
    if (!info || Date.now() - info.mtimeMs < olderThanMs) continue
    await rm(join(dir, entry), { force: true })
    removed += 1
  }
  return removed
}
