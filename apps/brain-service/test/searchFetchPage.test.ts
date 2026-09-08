/**
 * THE GUARDED FETCH PATH, exercised end to end without a network.
 *
 * `searchFetchGuard.test.ts` proves the URL screen. This proves the SEQUENCE,
 * which is where the interesting failures are: a name that resolves inward, a
 * redirect into the tailnet, a transport that quietly resolved the hostname
 * again after we screened it.
 *
 * Every primitive is injected, so each of those is a deterministic case rather
 * than something that would only appear against a hostile server.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchPage, type FetchDeps, type OpenRequest, type OpenResponse } from '../src/engine/search/fetchPage.js';

const headers = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
});

async function* bodyOf(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}

/** A transport that honours the pin, unless a test makes it misbehave. */
function deps(over: Partial<FetchDeps> & { page?: Partial<OpenResponse> } = {}): FetchDeps {
  let clock = 0;
  return {
    resolve: over.resolve ?? (async () => ['93.184.216.34']),
    now: over.now ?? (() => (clock += 1)),
    open:
      over.open ??
      (async (request: OpenRequest): Promise<OpenResponse> => ({
        status: 200,
        headers: headers({ 'content-type': 'text/html; charset=utf-8' }),
        body: bodyOf('<html><body>hello</body></html>'),
        // Honest by default: connected exactly where it was told to.
        connectedTo: request.pinnedAddress,
        ...over.page,
      })),
  };
}

/* ------------------------------------------------------------------ *
 * The happy path exists, so the negatives mean something
 * ------------------------------------------------------------------ */

test('an ordinary public page is fetched', async () => {
  const result = await fetchPage('https://example.com/article', deps());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.body, /hello/);
    assert.equal(result.finalUrl, 'https://example.com/article');
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 DNS
 * ------------------------------------------------------------------ */

test('🚨 a public HOSTNAME that resolves inward is refused', async () => {
  /*
   * The case URL screening cannot see. `https://evil.example/` is an entirely
   * ordinary URL whose A record says 10.10.0.13.
   */
  const result = await fetchPage('https://evil.example/', deps({ resolve: async () => ['10.10.0.13'] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'blocked');
});

test('🚨 a name resolving to the TAILNET is refused', async () => {
  const result = await fetchPage('https://looks-fine.example/', deps({ resolve: async () => ['100.95.14.29'] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'blocked');
});

test('🚨 ONE bad address among several poisons the whole resolution', async () => {
  /*
   * Otherwise an attacker publishes two A records — one public, one internal —
   * and relies on the transport picking the other one. All-or-nothing removes
   * that choice from the transport entirely.
   */
  const result = await fetchPage(
    'https://mixed.example/',
    deps({ resolve: async () => ['93.184.216.34', '169.254.169.254'] }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'blocked');
});

test('a name that does not resolve fails as transport, not as blocked', async () => {
  // Different facts. "Nowhere to connect" is not "you tried to reach inside".
  const result = await fetchPage('https://nx.example/', deps({ resolve: async () => [] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'transport_error');
});

/* ------------------------------------------------------------------ *
 * 🚨 Rebinding — the check that makes the others enforceable
 * ------------------------------------------------------------------ */

test('🚨 a transport that connected somewhere ELSE is treated as an attack', async () => {
  /*
   * Time-of-check-to-time-of-use. We screened 93.184.216.34; the transport
   * resolved again and reached 169.254.169.254. Every earlier check passed and
   * none of them was ENFORCED. Verifying the peer is what closes that.
   */
  const result = await fetchPage(
    'https://rebind.example/',
    deps({
      open: async () => ({
        status: 200,
        headers: headers({ 'content-type': 'text/html' }),
        body: bodyOf('<html>secret</html>'),
        connectedTo: '169.254.169.254',
      }),
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'blocked');
});

test('🚨 a transport that cannot say where it connected is refused', async () => {
  // Absent proof is not proof. Trusting it because we asked nicely is exactly
  // the gap the pin exists to close.
  const result = await fetchPage(
    'https://silent.example/',
    deps({
      open: async () => ({
        status: 200,
        headers: headers({ 'content-type': 'text/html' }),
        body: bodyOf('<html>x</html>'),
      }),
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'blocked');
});

test('the transport is told to connect to the screened address', async () => {
  let pinned: string | undefined;
  await fetchPage(
    'https://example.com/',
    deps({
      resolve: async () => ['93.184.216.34'],
      open: async (request) => {
        pinned = request.pinnedAddress;
        return {
          status: 200,
          headers: headers({ 'content-type': 'text/html' }),
          body: bodyOf('<html>x</html>'),
          connectedTo: request.pinnedAddress,
        };
      },
    }),
  );
  assert.equal(pinned, '93.184.216.34', 'the transport was not pinned to the screened address');
});

/* ------------------------------------------------------------------ *
 * 🚨 Redirects
 * ------------------------------------------------------------------ */

test('🚨 a redirect into a private network is refused', async () => {
  let call = 0;
  const result = await fetchPage(
    'https://example.com/start',
    deps({
      resolve: async (host) => (host === 'example.com' ? ['93.184.216.34'] : ['10.0.0.5']),
      open: async (request) => {
        call += 1;
        return call === 1
          ? {
              status: 302,
              headers: headers({ location: 'https://internal.example/secret' }),
              body: bodyOf(''),
              connectedTo: request.pinnedAddress,
            }
          : {
              status: 200,
              headers: headers({ 'content-type': 'text/html' }),
              body: bodyOf('<html>secret</html>'),
              connectedTo: request.pinnedAddress,
            };
      },
    }),
  );
  assert.equal(result.ok, false, 'the redirect target was fetched without screening');
  if (!result.ok) assert.equal(result.failure.kind, 'blocked');
});

test('a redirect target is RE-RESOLVED and re-screened, not inherited', async () => {
  const resolved: string[] = [];
  await fetchPage(
    'https://a.example/1',
    deps({
      resolve: async (host) => {
        resolved.push(host);
        return ['93.184.216.34'];
      },
      open: async (request) =>
        resolved.length === 1
          ? {
              status: 301,
              headers: headers({ location: 'https://b.example/2' }),
              body: bodyOf(''),
              connectedTo: request.pinnedAddress,
            }
          : {
              status: 200,
              headers: headers({ 'content-type': 'text/html' }),
              body: bodyOf('<html>ok</html>'),
              connectedTo: request.pinnedAddress,
            },
    }),
  );
  assert.deepEqual(resolved, ['a.example', 'b.example'], 'the redirect target was not re-resolved');
});

test('a relative redirect resolves against the current URL', async () => {
  let call = 0;
  const result = await fetchPage(
    'https://example.com/a/b',
    deps({
      open: async (request) => {
        call += 1;
        return call === 1
          ? {
              status: 302,
              headers: headers({ location: '/c' }),
              body: bodyOf(''),
              connectedTo: request.pinnedAddress,
            }
          : {
              status: 200,
              headers: headers({ 'content-type': 'text/html' }),
              body: bodyOf('<html>ok</html>'),
              connectedTo: request.pinnedAddress,
            };
      },
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.finalUrl, 'https://example.com/c');
});

test('a redirect loop is bounded', async () => {
  const result = await fetchPage(
    'https://example.com/loop',
    deps({
      open: async (request) => ({
        status: 302,
        headers: headers({ location: 'https://example.com/loop' }),
        body: bodyOf(''),
        connectedTo: request.pinnedAddress,
      }),
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'too_many_redirects');
});

/* ------------------------------------------------------------------ *
 * Bounds
 * ------------------------------------------------------------------ */

test('🚨 a body that keeps growing is cut off mid-stream', async () => {
  /*
   * Counting DECODED bytes as they arrive is what bounds a decompression bomb:
   * a small gzip expanding to gigabytes is stopped while streaming rather than
   * after it has been buffered.
   */
  async function* endless(): AsyncIterable<Uint8Array> {
    for (;;) yield new Uint8Array(1024);
  }
  const result = await fetchPage(
    'https://example.com/big',
    deps({
      open: async (request) => ({
        status: 200,
        headers: headers({ 'content-type': 'text/html' }),
        body: endless(),
        connectedTo: request.pinnedAddress,
      }),
    }),
    { maxBytes: 4096, timeoutMs: 100_000, maxRedirects: 2 },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'too_large');
});

test('a Content-Length claim does not override the real count', async () => {
  // The header is a claim by the party we are defending against.
  async function* big(): AsyncIterable<Uint8Array> {
    yield new Uint8Array(50_000);
  }
  const result = await fetchPage(
    'https://example.com/liar',
    deps({
      open: async (request) => ({
        status: 200,
        headers: headers({ 'content-type': 'text/html', 'content-length': '10' }),
        body: big(),
        connectedTo: request.pinnedAddress,
      }),
    }),
    { maxBytes: 1000, timeoutMs: 100_000, maxRedirects: 2 },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'too_large');
});

test('a non-page content type is refused', async () => {
  const result = await fetchPage(
    'https://example.com/file.pdf',
    deps({
      open: async (request) => ({
        status: 200,
        headers: headers({ 'content-type': 'application/pdf' }),
        body: bodyOf('%PDF'),
        connectedTo: request.pinnedAddress,
      }),
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'unreadable_type');
});

test('an HTTP error is reported as an error, not as an empty page', async () => {
  const result = await fetchPage(
    'https://example.com/gone',
    deps({
      open: async (request) => ({
        status: 404,
        headers: headers({ 'content-type': 'text/html' }),
        body: bodyOf('not found'),
        connectedTo: request.pinnedAddress,
      }),
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok && result.failure.kind === 'http_error') assert.equal(result.failure.status, 404);
});

test('an EMPTY page is a success, not a failure', async () => {
  // "Read, and had nothing in it" and "could not be read" are different facts.
  // Only the extractor may call the first one unusable.
  const result = await fetchPage(
    'https://example.com/empty',
    deps({
      open: async (request) => ({
        status: 200,
        headers: headers({ 'content-type': 'text/html' }),
        body: bodyOf(''),
        connectedTo: request.pinnedAddress,
      }),
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.body, '');
});

/* ------------------------------------------------------------------ *
 * Disclosure
 * ------------------------------------------------------------------ */

test('no failure reason discloses an address or internal topology', async () => {
  const cases: Array<[string, FetchDeps]> = [
    ['https://evil.example/', deps({ resolve: async () => ['10.10.0.13'] })],
    ['https://tail.example/', deps({ resolve: async () => ['100.95.14.29'] })],
    ['http://169.254.169.254/', deps()],
  ];
  for (const [url, d] of cases) {
    const result = await fetchPage(url, d);
    assert.equal(result.ok, false);
    const text = JSON.stringify(result);
    for (const leak of ['10.10.0.13', '100.95.14.29', '169.254.169.254']) {
      assert.ok(!text.includes(leak), `the failure leaked ${leak} for ${url}`);
    }
  }
});
