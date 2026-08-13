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
let activePort: AuthPort = unconfiguredAuthPort

/** Install an implementation. Used at composition root and by tests. */
export function setAuthPort(port: AuthPort): void {
  activePort = port
}

export function getAuthPort(): AuthPort {
  return activePort
}

/** Restore the fail-closed default. Test hygiene. */
export function resetAuthPort(): void {
  activePort = unconfiguredAuthPort
}

/** The current session, or null. Never throws for the unauthenticated case. */
export async function getSession(): Promise<AppSession | null> {
  return getAuthPort().getSession()
}

/**
 * The session, or throw. Every server operation that touches tenant data must
 * go through this — it is the only sanctioned way to obtain a principal.
 */
export async function requireSession(): Promise<AppSession> {
  const session = await getAuthPort().getSession()
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
