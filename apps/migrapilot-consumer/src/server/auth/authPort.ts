/**
 * The authentication port.
 *
 * These types mirror `@migrateck/auth-client` exactly (see
 * `MigraTeck/packages/auth-client/src/types.ts`). The consumer app depends on
 * this interface rather than on the package directly for one reason: the
 * package is `"private": true` and workspace-resolved, so it cannot be
 * installed while this application lives outside the monorepo.
 *
 * When the app lands at `apps/migrapilot-consumer`, `migraAuthPort()` becomes a
 * ~30-line adapter over the real package (see ./README.md) and nothing else in
 * the application changes.
 *
 * There is deliberately NO fallback that invents a user. An unconfigured auth
 * port fails closed — a consumer app must never simulate an authenticated
 * principal.
 */

/** Mirrors `@migrateck/auth-client` → `AuthenticatedUser`. */
export interface AuthenticatedUser {
  id: string
  email: string
  displayName?: string
}

/** Mirrors `@migrateck/auth-client` → `ResolvedOrg`. */
export interface ResolvedOrg {
  id: string
  name: string
  role: string
}

/** Mirrors `@migrateck/auth-client` → `BootstrapResult`. */
export interface BootstrapResult {
  activeOrg: ResolvedOrg | null
  permissions: string[]
  productAccount?: Record<string, unknown> | null
}

/** Mirrors `@migrateck/auth-client` → `BootstrapFn`. */
export type BootstrapFn = (input: {
  authUserId: string
  email: string
  displayName?: string
  accessToken: string
  refreshToken?: string
  expiresInSeconds: number
}) => Promise<BootstrapResult>

/**
 * Mirrors `@migrateck/auth-client` → `AppSession`.
 *
 * `authUserId` is the OIDC `sub` and is the ONLY acceptable canonical user
 * identifier for tenancy. `activeOrgId` comes from the bootstrap step, not from
 * token claims — see the #147 note in ./README.md.
 */
export interface AppSession {
  sessionId: string
  authUserId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  activeOrgRole?: string
  permissions: string[]
  productAccount?: Record<string, unknown> | null
  createdAt: number
  expiresAt: number
}

/** The subset of the auth-client surface this application actually consumes. */
export interface AuthPort {
  /** The current server-side session, or null when unauthenticated. */
  getSession(): Promise<AppSession | null>
  /** Where to send the browser to begin login (PKCE S256 authorize URL). */
  buildLoginRedirect(): Promise<string>
  /** Where to send the browser to end the session. */
  buildLogoutRedirect(): string
  /** Complete the OAuth callback: verify state, exchange code, bootstrap, set session. */
  handleCallback(params: { code: string; state: string; bootstrap: BootstrapFn }): Promise<void>
  /** Drop the application session. */
  clearSession(): Promise<void>
}

/** Thrown when no auth implementation is configured. Never falls back to a user. */
export class AuthNotConfiguredError extends Error {
  readonly code = 'AUTH_NOT_CONFIGURED'
  constructor() {
    super(
      'MigraAuth is not configured. This build has no auth implementation wired; ' +
        'see src/server/auth/README.md. Authentication cannot be simulated.',
    )
    this.name = 'AuthNotConfiguredError'
  }
}

/** Thrown when an operation requires a session and none exists. */
export class UnauthenticatedError extends Error {
  readonly code = 'UNAUTHENTICATED'
  constructor(message = 'Authentication required.') {
    super(message)
    this.name = 'UnauthenticatedError'
  }
}

/**
 * The fail-closed default. Every method refuses.
 *
 * This is the shipped default precisely so that a misconfigured deployment
 * cannot accidentally serve an unauthenticated or fabricated principal.
 */
export const unconfiguredAuthPort: AuthPort = {
  async getSession() {
    return null
  },
  async buildLoginRedirect() {
    throw new AuthNotConfiguredError()
  },
  buildLogoutRedirect() {
    throw new AuthNotConfiguredError()
  },
  async handleCallback() {
    throw new AuthNotConfiguredError()
  },
  async clearSession() {
    throw new AuthNotConfiguredError()
  },
}
