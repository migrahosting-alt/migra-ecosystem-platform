/**
 * Where a provider sign-in is allowed to land.
 *
 * `return_to` is chosen before the browser leaves for Google or GitHub and used
 * after it comes back, which makes it the classic open-redirect surface: an
 * attacker who can set it borrows MigraAuth's domain to send someone anywhere,
 * and the URL bar says `auth.migrateck.com` right up until it does not.
 *
 * SO IT IS AN ALLOWLIST OF ORIGINS, not a pattern and not a "starts with"
 * check. `https://auth.migrateck.com.evil.test` starts with the right string;
 * only comparing a parsed origin catches it. The value is validated when it is
 * STORED and again when it is USED, because the two happen in different
 * requests and only one of them is the one an attacker controls.
 */

import { config } from "../../config/env.js";

/** Origins this deployment will return a browser to after a provider sign-in. */
function allowedOrigins(): string[] {
  const origins = new Set<string>();
  for (const raw of [config.publicUrl, config.webUrl, ...config.social.returnOrigins]) {
    if (!raw) continue;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      // A malformed configured origin is ignored rather than crashing the
      // service — but it is also never matched, so it cannot widen anything.
    }
  }
  return [...origins];
}

/**
 * The destination, or null.
 *
 * Returns the normalized absolute URL so the caller redirects to something this
 * function actually inspected, rather than to the original string.
 */
export function safeReturnTo(value: string | undefined | null): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Relative values are refused rather than resolved. A provider callback has
    // no meaningful base to resolve against, and guessing one is how a
    // path-relative value becomes a different origin.
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!allowedOrigins().includes(parsed.origin)) return null;

  return parsed.toString();
}

/** Where to land when the caller named nowhere usable. */
export function defaultReturnTo(): string {
  return config.webUrl;
}

/**
 * Attach an outcome to the destination without disturbing what is already there.
 *
 * The authorize URL a provider sign-in returns to carries the client's PKCE
 * challenge and state. Rebuilding the query would drop them and break the very
 * flow this is completing, so parameters are ADDED to the parsed URL.
 */
export function withOutcome(returnTo: string, params: Record<string, string>): string {
  const url = new URL(returnTo);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
