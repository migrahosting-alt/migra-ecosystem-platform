import 'server-only'

import {
  UnauthenticatedError,
  unconfiguredAuthPort,
  type AppSession,
  type AuthPort,
} from './authPort'

/**
 * The single place the application resolves its auth implementation.
 *
 * Today this returns the fail-closed default. When the app lands in the
 * monorepo, `migraAuthPort` (a thin adapter over `@migrateck/auth-client`)
 * replaces it here — one line, no other call site changes.
 */
/** An explicit override always wins. This is the test/injection seam. */
let override: AuthPort | undefined

/** Memoised per-runtime resolution. Cleared whenever the override changes. */
let resolved: Promise<AuthPort> | undefined

/** Install an implementation. Used by tests and by any explicit composition root. */
export function setAuthPort(port: AuthPort): void {
  override = port
  resolved = undefined
}

/**
 * The auth implementation for THIS runtime.
 *
 * Async and lazily resolved on purpose. It previously returned a module-level
 * variable that `instrumentation.ts` mutated — but Next runs that hook in a
 * separate module graph, so route handlers read a different instance and always
 * saw the fail-closed default. Resolving here means the runtime that serves the
 * request is the one that reads the environment.
 *
 * Fail-closed is preserved: a failed or incomplete resolution yields
 * `unconfiguredAuthPort`, which refuses every operation.
 */
export async function getAuthPort(): Promise<AuthPort> {
  if (override) return override
  if (!resolved) {
    resolved = import('./resolveAuthPort')
      .then(({ resolveAuthPort }) => resolveAuthPort())
      .then((resolution) => {
        if (!resolution.configured) {
          console.warn(`[auth] MigraAuth not configured (missing: ${resolution.missing.join(', ')}). Running fail-closed.`)
        }
        return resolution.port
      })
      .catch((error) => {
        // Never let a resolution fault promote into a served principal.
        console.error('[auth] auth port resolution failed; serving fail-closed.', error)
        return unconfiguredAuthPort
      })
  }
  return resolved
}

/** Restore the fail-closed default and drop any memoised resolution. Test hygiene. */
export function resetAuthPort(): void {
  override = undefined
  resolved = undefined
}

/** The current session, or null. Never throws for the unauthenticated case. */
export async function getSession(): Promise<AppSession | null> {
  return (await getAuthPort()).getSession()
}

/**
 * The session, or throw. Every server operation that touches tenant data must
 * go through this — it is the only sanctioned way to obtain a principal.
 */
export async function requireSession(): Promise<AppSession> {
  const session = await (await getAuthPort()).getSession()
  if (!session) throw new UnauthenticatedError()
  if (session.expiresAt && session.expiresAt <= Date.now()) {
    throw new UnauthenticatedError('Session expired.')
  }
  return session
}

/**
 * The session shape a client component may receive.
 *
 * Deliberately narrow: no tokens, no productAccount blob, no session secret,
 * nothing that could be used to construct tenancy on the browser side.
 */
export interface PublicSession {
  displayName: string
  email: string
  activeOrgName?: string
  activeOrgRole?: string
  permissions: string[]
}

export function toPublicSession(session: AppSession): PublicSession {
  return {
    displayName: session.displayName ?? session.email,
    email: session.email,
    ...(session.activeOrgName ? { activeOrgName: session.activeOrgName } : {}),
    ...(session.activeOrgRole ? { activeOrgRole: session.activeOrgRole } : {}),
    permissions: session.permissions,
  }
}

export * from './authPort'
