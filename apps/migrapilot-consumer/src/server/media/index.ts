import 'server-only'

import { LocalMediaStorage } from './localMediaStorage'
import type { MediaStorage } from './mediaStorage'

export * from './mediaStorage'
export { LocalMediaStorage } from './localMediaStorage'

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
let configured: { root: string; storage: MediaStorage } | null = null

const mediaRoot = (): string => process.env.IMAGE_ROOT ?? '/var/lib/migrapilot/images'

export function mediaStorage(): MediaStorage {
  const root = mediaRoot()
  if (configured?.root !== root) {
    configured = { root, storage: new LocalMediaStorage(root) }
  }
  return configured.storage
}

/** Point the application at a different backend. Used by tests and, later, by
 *  the object-store cutover. */
export function setMediaStorage(storage: MediaStorage): void {
  configured = { root: mediaRoot(), storage }
}
