/**
 * THE GOOGLE OAUTH CONFIG CONTRACT — the canonical source of the redirect URI.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS FILE EXISTS BEFORE THE GOOGLE CLOUD CLIENT
 *
 * An OAuth client cannot be created without a redirect URI, and there was no
 * canonical one anywhere in this codebase. Typing one into a Google form would
 * have made the console the source of truth and the code a copy of it — so the
 * first mismatch would be discovered by a user, at the moment their sign-in
 * bounced with `redirect_uri_mismatch`.
 *
 * The value is defined HERE, derived from deployment config, and the Google
 * client is configured to match it. `expectedRedirectUri()` is what a human
 * transcribes into the console, and a test asserts its exact shape so a change
 * to it is a deliberate act with a visible diff.
 *
 * ---------------------------------------------------------------------------
 * NO PRODUCTION HOSTNAME IN APP LOGIC
 *
 * The public origin comes from configuration. Hardcoding `chat.migrateck.com`
 * would make a staging deployment silently redirect users into production, and
 * would make the value impossible to change without a code release.
 *
 * ---------------------------------------------------------------------------
 * SCOPES ARE REQUESTED SEPARATELY AND DELIBERATELY
 *
 * Read first. Send is not requested until governed send is wired and qualified,
 * because a consent screen asking for permission to send mail before the
 * product has demonstrated it can read any is asking for the irreversible
 * permission first. `scopesFor` exists so the requested set matches the live
 * capability rather than an aspiration.
 */

/** Google's own scope strings. The only place they appear. */
export const GOOGLE_SCOPES = {
  /** Search, read, threads, attachment metadata and bytes. Read-only. */
  read: 'https://www.googleapis.com/auth/gmail.readonly',
  /** Create a draft IN the user's mailbox. A mutation. */
  draft: 'https://www.googleapis.com/auth/gmail.compose',
  /** Dispatch. Irreversible. */
  send: 'https://www.googleapis.com/auth/gmail.send',
} as const;

export type GrantKind = keyof typeof GOOGLE_SCOPES;

/**
 * Environment variable names. Stated once, so the boundary doc, the console
 * and the code cannot drift into three different opinions.
 *
 * 🚨 The SECRET is read from the environment and never returned by any
 * accessor here — `oauthConfigFrom` deliberately exposes a `hasSecret` boolean
 * rather than the value, so a config object cannot leak it by being logged.
 */
export const ENV = {
  clientId: 'MIGRAPILOT_GOOGLE_CLIENT_ID',
  clientSecret: 'MIGRAPILOT_GOOGLE_CLIENT_SECRET',
  /** Public origin of the CONSUMER, e.g. https://chat.example.com — no path. */
  publicOrigin: 'MIGRAPILOT_PUBLIC_ORIGIN',
} as const;

/**
 * The callback path. A constant, not configuration.
 *
 * Making it configurable would mean the console and the deployment could
 * disagree about it while both being "valid", and the mismatch would only
 * appear at a user's sign-in. One value, in one place.
 */
export const CALLBACK_PATH = '/api/account/mail/callback';

export interface OAuthConfig {
  clientId: string;
  /** True when a secret is configured. The value never leaves the env. */
  hasSecret: boolean;
  redirectUri: string;
}

export type ConfigProblem =
  | { kind: 'missing'; variable: string }
  | { kind: 'invalid_origin'; detail: string };

/**
 * Build the config, or say precisely what is missing.
 *
 * Returns problems rather than throwing so the capability can report "not set
 * up yet" and name the gap for an operator, instead of the process failing to
 * boot because a feature nobody has enabled is unconfigured.
 */
export function oauthConfigFrom(
  env: Record<string, string | undefined>,
): { ok: true; config: OAuthConfig } | { ok: false; problems: ConfigProblem[] } {
  const problems: ConfigProblem[] = [];

  const clientId = env[ENV.clientId]?.trim();
  const secret = env[ENV.clientSecret]?.trim();
  const origin = env[ENV.publicOrigin]?.trim();

  if (!clientId) problems.push({ kind: 'missing', variable: ENV.clientId });
  if (!secret) problems.push({ kind: 'missing', variable: ENV.clientSecret });
  if (!origin) problems.push({ kind: 'missing', variable: ENV.publicOrigin });

  let redirectUri = '';
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      problems.push({ kind: 'invalid_origin', detail: 'the public origin is not a URL' });
      return { ok: false, problems };
    }
    /*
     * 🚨 HTTPS ONLY, AND NO PATH.
     *
     * Google refuses non-HTTPS redirect URIs for web clients other than
     * localhost, and an origin carrying a path would silently produce
     * `https://host/app/api/...` — a URI that would then have to be registered
     * separately and would not match. Rejecting it here turns a
     * redirect_uri_mismatch at a user's sign-in into a startup-time complaint.
     */
    if (parsed.protocol !== 'https:') {
      problems.push({ kind: 'invalid_origin', detail: 'the public origin must be https' });
    }
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      problems.push({ kind: 'invalid_origin', detail: 'the public origin must be an origin, with no path' });
    }
    redirectUri = `${parsed.origin}${CALLBACK_PATH}`;
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: { clientId: clientId!, hasSecret: true, redirectUri } };
}

/**
 * The exact string to enter in the Google Cloud console.
 *
 * Exported so a human transcribes a value the code produced, rather than the
 * code being written to match something typed into a form.
 */
export function expectedRedirectUri(publicOrigin: string): string {
  return `${new URL(publicOrigin).origin}${CALLBACK_PATH}`;
}

/**
 * The scopes to request for a given capability set.
 *
 * Narrow by default and additive by intent: asking for send before send works
 * requests the irreversible permission on the strength of a promise.
 */
export function scopesFor(grants: readonly GrantKind[]): string[] {
  // Deduplicated and ordered so two equivalent requests produce one consent
  // screen rather than two that look different to Google.
  return [...new Set(grants.map((g) => GOOGLE_SCOPES[g]))].sort();
}

/** What an operator is told when configuration is incomplete. Never a value. */
export function configProblemMessage(problems: readonly ConfigProblem[]): string {
  const missing = problems.filter((p) => p.kind === 'missing').map((p) => (p as { variable: string }).variable);
  const invalid = problems.filter((p) => p.kind === 'invalid_origin').map((p) => (p as { detail: string }).detail);
  const parts: string[] = [];
  if (missing.length) parts.push(`not set: ${missing.join(', ')}`);
  if (invalid.length) parts.push(invalid.join('; '));
  return parts.join(' — ');
}
