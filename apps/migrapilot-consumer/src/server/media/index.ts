import 'server-only'

import { DualReadMediaStorage, type StorageHealthEvent } from './dualReadMediaStorage'
import { recordMediaHealth } from './healthCounters'
import { LocalMediaStorage } from './localMediaStorage'
import { ObjectMediaStorage } from './objectMediaStorage'
import type { MediaStorage } from './mediaStorage'

export * from './mediaStorage'
export { LocalMediaStorage } from './localMediaStorage'
export { ObjectMediaStorage } from './objectMediaStorage'
export { DualReadMediaStorage } from './dualReadMediaStorage'
export { mediaHealthSnapshot, recordMediaHealth, flushMediaHealth } from './healthCounters'

/**
 * The storage this deployment uses.
 *
 * ONE PLACE DECIDES. Every caller asks for `mediaStorage()` and gets whatever is
 * configured, so moving bytes off this machine is a change here and nowhere
 * else. Today that is always local; the object-store implementation slots in
 * without any caller learning about it.
 *
 * Resolved lazily and cached, because the root is read from the environment and
 * tests set it after import.
 */
let configured: { key: string; storage: MediaStorage } | null = null

const mediaRoot = (): string => process.env.IMAGE_ROOT ?? '/var/lib/migrapilot/images'

/**
 * A storage event worth counting, emitted as one greppable line.
 *
 * A fallback is not an error — the read SUCCEEDED — but it is the number that
 * says whether the migration is working. Without it, object storage could be
 * broken for weeks while every page looked perfectly healthy.
 */
function reportHealth(event: StorageHealthEvent): void {
  console.info(`migrapilot.media.health ${JSON.stringify(event)}`)
  // Counted to a file as well, because the log line above is read by nobody.
  recordMediaHealth(event)
}

/**
 * Object storage, when this deployment is configured for it.
 *
 * Absent configuration is not a failure: the local backend is the supported
 * standalone mode, and a workstation needs no infrastructure to run the product.
 */
function objectStorage(): ObjectMediaStorage | null {
  const endpoint = process.env.MIGRAPILOT_MEDIA_ENDPOINT
  const bucket = process.env.MIGRAPILOT_MEDIA_BUCKET
  const accessKeyId = process.env.MIGRAPILOT_MEDIA_ACCESS_KEY
  const secretAccessKey = process.env.MIGRAPILOT_MEDIA_SECRET_KEY
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  return new ObjectMediaStorage({
    endpoint,
    bucket,
    ...(process.env.MIGRAPILOT_MEDIA_PREFIX ? { prefix: process.env.MIGRAPILOT_MEDIA_PREFIX } : {}),
    ...(process.env.MIGRAPILOT_MEDIA_REGION ? { region: process.env.MIGRAPILOT_MEDIA_REGION } : {}),
    credentials: { accessKeyId, secretAccessKey },
  })
}

/**
 * Where new artifacts are written.
 *
 * Defaults to `local`, so a deployment that has not been through the cutover
 * cannot be moved onto object storage by accident — the safe state is the one
 * you get by saying nothing.
 */
function canonicalWriteTarget(): 'local' | 'object' {
  return process.env.MIGRAPILOT_MEDIA_CANONICAL_WRITES === 'object' ? 'object' : 'local'
}

export function mediaStorage(): MediaStorage {
  const root = mediaRoot()
  const object = objectStorage()
  // Cached on the shape of the configuration, so a test that changes the
  // environment gets a storage that reflects it.
  // The write target is part of the key: without it, a process that had already
  // built a storage would keep the OLD write behaviour after the flag changed.
  const key = `${root}|${object ? process.env.MIGRAPILOT_MEDIA_ENDPOINT : 'local'}|${canonicalWriteTarget()}`
  if (configured?.key !== key) {
    const local = new LocalMediaStorage(root)
    configured = {
      key,
      /*
       * Reads always prefer object storage. WRITES depend on the deployment:
       * before cutover they stay local, so the object path is exercised by real
       * traffic under a safety net long before it is trusted with a write;
       * after cutover the object store is the authority and the local copy is
       * kept as rollback material.
       */
      storage: object
        ? new DualReadMediaStorage({
            object,
            local,
            onHealth: reportHealth,
            canonicalWrites: canonicalWriteTarget(),
          })
        : local,
    }
  }
  return configured.storage
}

/** Point the application at a different backend. Used by tests and, later, by
 *  the object-store cutover. */
export function setMediaStorage(storage: MediaStorage): void {
  configured = { key: 'explicit', storage }
}
