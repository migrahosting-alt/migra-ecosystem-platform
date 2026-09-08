/**
 * WHAT MAY BE FETCHED — the boundary between "a search result" and "a request
 * this server makes on someone else's behalf".
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE THREAT, STATED PLAINLY
 *
 * A search result is an attacker-influenceable URL. The moment the engine
 * fetches one, every internal address this host can reach becomes reachable by
 * anyone who can get a URL into a result set — a page they control, a wiki
 * they can edit, a repository they can push to. That is server-side request
 * forgery, and on this deployment the blast radius is concrete: the Brain runs
 * beside the consumer, holds Postgres credentials, and sits on a tailnet with
 * every other Migra host on it.
 *
 * Cloud metadata endpoints are the classic prize (169.254.169.254), but here
 * the tailnet is the bigger one: 100.64.0.0/10 reaches the whole fleet.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE, PURE MODULE
 *
 * The decision must be testable exhaustively and without a network. A guard
 * tangled into the fetch call gets exercised only along whichever paths a test
 * happens to take, and the paths nobody takes are exactly where this kind of
 * bug lives.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DNS CAVEAT, RECORDED RATHER THAN GLOSSED
 *
 * This module decides on the URL. A hostname that resolves to a private address
 * — DNS rebinding, or simply an attacker's A record pointing at 10.0.0.1 —
 * cannot be caught here, because resolution has not happened yet. The fetcher
 * must ALSO check the resolved address before connecting and again on every
 * redirect. `isBlockedAddress` exists for that caller, and a deployment that
 * calls only `screenUrl` is protected against literals and nothing else.
 */

/** Schemes that may be fetched. Everything else is refused by absence. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export type UrlVerdict =
  | { allowed: true; url: URL }
  | { allowed: false; reason: string };

/**
 * Whether a resolved IP address must never be connected to.
 *
 * An allowlist would be safer still, but the open web is the point of this
 * capability, so the denylist has to be exhaustive. Each range below is here
 * because it reaches something that is not the public internet.
 */
export function isBlockedAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();

  // ── IPv6 ──────────────────────────────────────────────────────────────────
  if (ip.includes(':')) {
    const bare = ip.replace(/^\[|\]$/g, '');
    if (bare === '::1' || bare === '::') return true;
    // Unique local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(bare)) return true;
    if (/^fe[89ab]/.test(bare)) return true;
    /*
     * IPv4-mapped and -compatible forms (::ffff:10.0.0.1). Without this, every
     * IPv4 rule below is bypassable by spelling the address in IPv6.
     */
    const mapped = bare.match(/(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    return false;
  }

  // ── IPv4 ──────────────────────────────────────────────────────────────────
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];

  if (a === 0) return true;                       // "this network"
  if (a === 10) return true;                      // RFC1918
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local AND cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true;        // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT — the TAILNET lives here
  if (a === 192 && b === 0) return true;          // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true;                      // multicast + reserved + broadcast
  return false;
}

/**
 * Screen a URL before any connection is attempted.
 *
 * Refusals name the CLASS of problem, never the internal address they
 * protected — an error message that echoes back "10.0.0.5 refused" is itself a
 * network-mapping oracle for whoever planted the URL.
 */
export function screenUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: 'That link could not be read.' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    // file:, gopher:, ftp:, data: — and anything a future library invents.
    return { allowed: false, reason: 'Only web pages can be opened.' };
  }

  /*
   * Credentials in a URL would be sent to whatever the host resolves to. They
   * are also a strong signal the link was constructed rather than published.
   */
  if (url.username || url.password) {
    return { allowed: false, reason: 'That link carries credentials and was not opened.' };
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { allowed: false, reason: 'That link has no host.' };

  // Literal addresses are decided here. Hostnames are decided after resolution,
  // by the caller — see the header.
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isBlockedAddress(host)) {
      return { allowed: false, reason: 'That link points inside a private network.' };
    }
  }

  /*
   * Names that never denote the public internet. `localhost` is the obvious
   * one; `.internal`, `.local` and friends are how internal services are named
   * on this fleet and elsewhere.
   */
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { allowed: false, reason: 'That link points inside a private network.' };
  }
  for (const suffix of ['.internal', '.local', '.lan', '.home.arpa', '.intranet', '.ts.net']) {
    if (host.endsWith(suffix)) {
      return { allowed: false, reason: 'That link points inside a private network.' };
    }
  }
  // A bare single-label host can only resolve through a search domain, which
  // means an internal name.
  if (!host.includes('.')) {
    return { allowed: false, reason: 'That link points inside a private network.' };
  }

  return { allowed: true, url };
}

/** Bounds a fetch must respect. Not advisory — the fetcher enforces each. */
export interface FetchLimits {
  /** Refuse a body larger than this, measured AS IT ARRIVES. */
  maxBytes: number;
  /** Total wall-clock budget across all redirects. */
  timeoutMs: number;
  /** Redirects followed before giving up. */
  maxRedirects: number;
}

export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  /*
   * Two megabytes of HTML is an enormous article. The limit exists because a
   * Content-Length header is a claim by the server being fetched, so the real
   * defence is counting bytes as they arrive — see `fetchPage.ts`.
   */
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 12_000,
  maxRedirects: 3,
};

/** Content types worth extracting text from. Anything else is not a page. */
export function isReadableContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml' || type === 'text/plain';
}
