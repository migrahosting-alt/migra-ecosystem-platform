/**
 * Which routes render the public marketing header and footer.
 *
 * This lives apart from the component because it is a rule, not rendering, and
 * because it has already been got wrong once: the two lists below were collapsed
 * into one, which stripped the site header from the public /platform marketing
 * page — leaving the single page that pitches the unified identity layer with no
 * navigation and no way to sign in.
 *
 * The test for membership is "does the route guard a session?", NOT "does its
 * name sound like an app".
 */

/** Internal whether matched exactly or as a parent (/console and /console/x). */
export const INTERNAL_PREFIXES = [
  "/console",
  "/dashboard",
  "/builder",
  "/hosting",
  "/intake",
  "/app",
] as const;

/**
 * NESTED-ONLY. "/platform" is two different things:
 *   - "/platform" bare — a PUBLIC marketing page, zero auth guards.
 *   - "/platform/*"    — ten authenticated surfaces (overview, organizations,
 *     members, billing, security, compliance, hosting, intake, usage) that live
 *     in the (platform) route group, which is why a `find` over src/app/platform
 *     does not list them.
 *
 * Collapsing these one way hides the public page's nav; collapsing them the other
 * hands the public nav to every signed-in platform surface.
 */
export const INTERNAL_NESTED_PREFIXES = ["/platform"] as const;

/** True when the route is an authenticated surface that must not show public chrome. */
export function isInternalPath(pathname: string | null): boolean {
  if (!pathname) {
    return false;
  }

  if (INTERNAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }

  return INTERNAL_NESTED_PREFIXES.some((prefix) => pathname.startsWith(`${prefix}/`));
}
