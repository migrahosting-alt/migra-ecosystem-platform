/**
 * Console session cookie — single source of truth for the cookie name and path.
 * PURE module (no next imports).
 *
 * The cookie is set with Path "/console" (see auth.ts issueSession), so logout
 * must expire it at "/console". Next.js collapses multiple Set-Cookie headers
 * that share a name (keeps the last), so logout emits exactly ONE clear at
 * "/console" via the cookie store (clearSession) — the only path the cookie
 * ever lives at.
 */

export const SESSION_COOKIE_NAME = "migrateck_console_session";
export const SESSION_COOKIE_PATH = "/console";
