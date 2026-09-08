/**
 * THE GUARDED FETCH PATH.
 *
 * ---------------------------------------------------------------------------
 * THE SEQUENCE, AND WHY EVERY STEP IS LOAD-BEARING
 *
 *   parse → scheme → RESOLVE → screen every address → connect PINNED to a
 *   screened address → on redirect, start over → bounded body → content type
 *
 * `fetchGuard.ts` screens the URL. That stops literals and internal names, and
 * it is not enough on its own: `https://evil.example/` is a perfectly ordinary
 * URL whose A record says `10.10.0.13`. Only resolution reveals that, so
 * resolution happens here and every returned address is screened.
 *
 * ---------------------------------------------------------------------------
 * 🚨 DNS REBINDING — WHY SCREENING ALONE IS STILL NOT ENOUGH
 *
 * Screening the resolved address and then handing the URL to an HTTP client is
 * a time-of-check-to-time-of-use bug with a name. The client performs its OWN
 * resolution, and an attacker controlling the zone can answer the first query
 * with a public address and the second with `169.254.169.254`. Everything was
 * checked; nothing was enforced.
 *
 * So this does not pass a hostname to the transport. It passes the ADDRESS it
 * screened, and the transport is required to connect to exactly that peer.
 * `connectedTo` on the response is how the transport proves which peer it
 * reached, and a mismatch is treated as an attack rather than a curiosity.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PRIMITIVES ARE INJECTED
 *
 * `resolve` and `open` are parameters. A security boundary that can only be
 * exercised by making real network calls gets tested along the one happy path
 * someone had patience for, and the paths nobody took are where this class of
 * bug lives. Injected, every branch — a rebinding answer, a redirect into the
 * tailnet, a body that keeps growing — is a deterministic unit test.
 */

import {
  DEFAULT_FETCH_LIMITS,
  isBlockedAddress,
  isReadableContentType,
  screenUrl,
  type FetchLimits,
} from './fetchGuard.js';

export interface OpenRequest {
  url: URL;
  /** The transport MUST connect here. It must not resolve the hostname again. */
  pinnedAddress: string;
  timeoutMs: number;
  /** Decoded-byte ceiling. The transport aborts rather than buffering past it. */
  maxBytes: number;
}

export interface OpenResponse {
  status: number;
  headers: { get(name: string): string | null };
  /** Decoded body chunks. Decompression happens below this interface. */
  body: AsyncIterable<Uint8Array>;
  /**
   * The peer actually connected to. Compared against `pinnedAddress`; a
   * transport that cannot report this cannot be trusted to have honoured the
   * pin, so an absent value is a refusal rather than a pass.
   */
  connectedTo?: string;
}

export interface FetchDeps {
  /** Every address the hostname resolves to. */
  resolve(hostname: string): Promise<string[]>;
  open(request: OpenRequest): Promise<OpenResponse>;
  now(): number;
}

export type FetchFailure =
  | { kind: 'refused'; reason: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'timeout'; waitedMs: number }
  | { kind: 'too_large'; limitBytes: number }
  | { kind: 'too_many_redirects'; limit: number }
  | { kind: 'unreadable_type'; contentType: string | null }
  | { kind: 'http_error'; status: number }
  | { kind: 'transport_error'; reason: string };

export type FetchResult =
  | { ok: true; finalUrl: string; body: string; contentType: string; bytes: number; tookMs: number }
  | { ok: false; failure: FetchFailure; tookMs: number };

/** The refusal a user may see. It never names an address or a host. */
const PRIVATE_NETWORK = 'That link points inside a private network.';

/**
 * Screen a hostname's resolution.
 *
 * EVERY address must pass. Picking whichever one happens to be public would
 * let an attacker publish two A records — one public, one internal — and rely
 * on the transport choosing the other. All-or-nothing removes that choice.
 */
async function screenResolution(
  hostname: string,
  deps: FetchDeps,
): Promise<{ ok: true; address: string } | { ok: false; failure: FetchFailure }> {
  let addresses: string[];
  try {
    addresses = await deps.resolve(hostname);
  } catch {
    // A name that does not resolve is not reachable; it is also not evidence
    // of anything worth reporting in detail.
    return { ok: false, failure: { kind: 'transport_error', reason: 'That site could not be reached.' } };
  }

  if (addresses.length === 0) {
    return { ok: false, failure: { kind: 'transport_error', reason: 'That site could not be reached.' } };
  }
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      return { ok: false, failure: { kind: 'blocked', reason: PRIVATE_NETWORK } };
    }
  }
  return { ok: true, address: addresses[0]! };
}

/**
 * Fetch one page, or fail truthfully.
 *
 * An empty body is a SUCCESS with nothing in it, not a failure — "the page was
 * read and had no article in it" and "the page could not be read" are
 * different facts, and the extractor is what distinguishes them.
 */
export async function fetchPage(
  rawUrl: string,
  deps: FetchDeps,
  limits: FetchLimits = DEFAULT_FETCH_LIMITS,
): Promise<FetchResult> {
  const started = deps.now();
  const elapsed = () => deps.now() - started;

  let current = rawUrl;
  let redirects = 0;

  // A redirect is a NEW fetch of a NEW url, so the loop re-runs every check.
  // Falling through to a shared "follow" helper that skipped screening is the
  // mistake this shape exists to prevent.
  for (;;) {
    if (elapsed() >= limits.timeoutMs) {
      return { ok: false, failure: { kind: 'timeout', waitedMs: elapsed() }, tookMs: elapsed() };
    }

    const screened = screenUrl(current);
    if (!screened.allowed) {
      // A URL-level refusal is `blocked` when it is about network location and
      // `refused` when it is about form; the caller renders them differently.
      const kind = screened.reason === PRIVATE_NETWORK ? 'blocked' : 'refused';
      return { ok: false, failure: { kind, reason: screened.reason } as FetchFailure, tookMs: elapsed() };
    }
    const url = screened.url;

    const resolution = await screenResolution(url.hostname, deps);
    if (!resolution.ok) return { ok: false, failure: resolution.failure, tookMs: elapsed() };

    let response: OpenResponse;
    try {
      response = await deps.open({
        url,
        pinnedAddress: resolution.address,
        timeoutMs: Math.max(1, limits.timeoutMs - elapsed()),
        maxBytes: limits.maxBytes,
      });
    } catch (error) {
      const reason = error instanceof Error && /timeout/i.test(error.message) ? 'timeout' : 'transport';
      return reason === 'timeout'
        ? { ok: false, failure: { kind: 'timeout', waitedMs: elapsed() }, tookMs: elapsed() }
        : {
            ok: false,
            failure: { kind: 'transport_error', reason: 'That page could not be read.' },
            tookMs: elapsed(),
          };
    }

    /*
     * 🚨 THE PIN IS VERIFIED, NOT ASSUMED.
     *
     * A transport that resolved the name again — or that cannot say which peer
     * it reached — has defeated every check above. Trusting it because we
     * asked nicely is exactly the time-of-check-to-time-of-use gap.
     */
    if (response.connectedTo !== resolution.address) {
      return { ok: false, failure: { kind: 'blocked', reason: PRIVATE_NETWORK }, tookMs: elapsed() };
    }

    // ── redirects ───────────────────────────────────────────────────────────
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { ok: false, failure: { kind: 'http_error', status: response.status }, tookMs: elapsed() };
      }
      if (redirects >= limits.maxRedirects) {
        return {
          ok: false,
          failure: { kind: 'too_many_redirects', limit: limits.maxRedirects },
          tookMs: elapsed(),
        };
      }
      redirects += 1;
      // Resolved against the CURRENT url so a relative Location works, and then
      // screened from the top of the loop like any other target.
      current = new URL(location, url).toString();
      continue;
    }

    if (response.status >= 400) {
      return { ok: false, failure: { kind: 'http_error', status: response.status }, tookMs: elapsed() };
    }

    const contentType = response.headers.get('content-type');
    if (!isReadableContentType(contentType)) {
      return { ok: false, failure: { kind: 'unreadable_type', contentType }, tookMs: elapsed() };
    }

    /*
     * BYTES ARE COUNTED AS THEY ARRIVE.
     *
     * Content-Length is a claim by the server being fetched, so it is not a
     * limit — it is a hint from the party we are defending against. Counting
     * DECODED bytes also bounds a decompression bomb: a small gzip that
     * expands to gigabytes is stopped mid-stream rather than after buffering.
     */
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > limits.maxBytes) {
          return { ok: false, failure: { kind: 'too_large', limitBytes: limits.maxBytes }, tookMs: elapsed() };
        }
        if (elapsed() >= limits.timeoutMs) {
          return { ok: false, failure: { kind: 'timeout', waitedMs: elapsed() }, tookMs: elapsed() };
        }
        chunks.push(chunk);
      }
    } catch {
      return {
        ok: false,
        failure: { kind: 'transport_error', reason: 'That page could not be read.' },
        tookMs: elapsed(),
      };
    }

    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    return {
      ok: true,
      finalUrl: url.toString(),
      body,
      contentType: contentType ?? '',
      bytes,
      tookMs: elapsed(),
    };
  }
}
