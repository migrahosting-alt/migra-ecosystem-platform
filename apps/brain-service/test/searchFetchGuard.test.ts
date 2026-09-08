/**
 * SSRF SCREENING — the guard between "a search result" and "a request this
 * server makes on an attacker's behalf".
 *
 * A search result is an attacker-influenceable URL: a page they control, a wiki
 * they can edit, a repo they can push to. The moment the engine fetches one,
 * every internal address this host can reach becomes reachable by whoever
 * planted it. On this deployment that is concrete — the Brain holds Postgres
 * credentials and sits on a tailnet with the whole fleet.
 *
 * These are exhaustive on purpose. A guard exercised only along the paths a
 * happy-path test happens to take is precisely where this class of bug lives.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FETCH_LIMITS,
  isBlockedAddress,
  isReadableContentType,
  screenUrl,
} from '../src/engine/search/fetchGuard.js';

const refused = (raw: string) => {
  const verdict = screenUrl(raw);
  assert.equal(verdict.allowed, false, `${raw} was ALLOWED and must not be`);
  return verdict as { allowed: false; reason: string };
};

const allowed = (raw: string) => {
  const verdict = screenUrl(raw);
  assert.equal(verdict.allowed, true, `${raw} was refused and should be allowed`);
};

/* ------------------------------------------------------------------ *
 * Address ranges
 * ------------------------------------------------------------------ */

test('loopback, RFC1918 and link-local are blocked', () => {
  for (const ip of ['127.0.0.1', '127.1.1.1', '10.0.0.1', '10.10.0.13', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '0.0.0.0']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} was not blocked`);
  }
});

test('🚨 the cloud metadata endpoint is blocked', () => {
  // The classic SSRF prize: credentials, in plain text, over HTTP, no auth.
  assert.equal(isBlockedAddress('169.254.169.254'), true);
});

test('🚨 the TAILNET range is blocked', () => {
  /*
   * On this fleet the CGNAT range is the bigger prize than cloud metadata:
   * 100.64.0.0/10 reaches every other Migra host. A guard that stopped at
   * RFC1918 would have left the entire tailnet fetchable.
   */
  for (const ip of ['100.64.0.1', '100.95.14.29', '100.127.255.254']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} — tailnet address was not blocked`);
  }
  // 100.x outside the CGNAT block is ordinary public space and must stay usable.
  assert.equal(isBlockedAddress('100.63.255.255'), false);
  assert.equal(isBlockedAddress('100.128.0.1'), false);
});

test('172.16/12 is blocked at its true edges, and 172.32 is not', () => {
  // The range is 172.16–172.31. Treating all of 172/8 as private would block
  // real public hosts; stopping at 172.16 would leave most of it open.
  assert.equal(isBlockedAddress('172.15.0.1'), false);
  assert.equal(isBlockedAddress('172.16.0.1'), true);
  assert.equal(isBlockedAddress('172.31.0.1'), true);
  assert.equal(isBlockedAddress('172.32.0.1'), false);
});

test('multicast, broadcast and reserved space are blocked', () => {
  for (const ip of ['224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} was not blocked`);
  }
});

test('ordinary public addresses are allowed', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} was blocked and should not be`);
  }
});

/* ------------------------------------------------------------------ *
 * IPv6, including the bypasses
 * ------------------------------------------------------------------ */

test('IPv6 loopback and private ranges are blocked', () => {
  for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} was not blocked`);
  }
});

test('🚨 an IPv4 private address spelled as IPv6 is still blocked', () => {
  /*
   * Without mapped-form handling, every IPv4 rule is bypassable by writing the
   * address differently. ::ffff:10.0.0.1 and 10.0.0.1 are the same destination.
   */
  assert.equal(isBlockedAddress('::ffff:10.0.0.1'), true);
  assert.equal(isBlockedAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedAddress('::ffff:169.254.169.254'), true);
  assert.equal(isBlockedAddress('::ffff:100.95.14.29'), true, 'tailnet via IPv6 mapping');
});

test('a public IPv6 address is allowed', () => {
  assert.equal(isBlockedAddress('2606:4700:4700::1111'), false);
});

/* ------------------------------------------------------------------ *
 * URL screening
 * ------------------------------------------------------------------ */

test('non-web schemes are refused', () => {
  for (const raw of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com/', 'data:text/html,<b>x</b>']) {
    refused(raw);
  }
});

test('🚨 a literal private address in a URL is refused', () => {
  for (const raw of [
    'http://127.0.0.1:3988/api/version',
    'http://169.254.169.254/latest/meta-data/',
    'https://10.10.0.13:3000/api/version',
    'http://100.95.14.29/',
    'http://[::1]:8080/',
  ]) {
    refused(raw);
  }
});

test('internal NAMES are refused even though they are not literals', () => {
  for (const raw of [
    'http://localhost:3988/',
    'http://db-core.internal/',
    'http://printer.local/',
    'https://something.ts.net/',
    'http://intranet/',
  ]) {
    refused(raw);
  }
});

test('a bare single-label host is refused', () => {
  // It can only resolve through a search domain, which means an internal name.
  refused('http://buildserver/');
});

test('credentials in a URL are refused', () => {
  // They would be sent to whatever the host resolves to, and their presence is
  // a strong signal the link was constructed rather than published.
  refused('https://user:secret@example.com/page');
});

test('a refusal never echoes back the internal address it protected', () => {
  /*
   * The error reaches a user and, through them, whoever planted the URL. Naming
   * the address turns every refusal into a network-mapping oracle.
   */
  for (const raw of ['http://10.10.0.13/x', 'http://169.254.169.254/', 'http://100.95.14.29/']) {
    const verdict = refused(raw);
    for (const leak of ['10.10.0.13', '169.254.169.254', '100.95.14.29']) {
      assert.ok(!verdict.reason.includes(leak), `the refusal leaked ${leak}: "${verdict.reason}"`);
    }
  }
});

test('ordinary public pages are allowed', () => {
  for (const raw of ['https://example.com/article', 'http://news.example.co.uk/a/b?c=1']) {
    allowed(raw);
  }
});

test('an unparseable URL is refused rather than passed through', () => {
  refused('not a url at all');
});

/* ------------------------------------------------------------------ *
 * Limits and content types
 * ------------------------------------------------------------------ */

test('the default limits are bounded in every dimension', () => {
  assert.ok(DEFAULT_FETCH_LIMITS.maxBytes > 0 && DEFAULT_FETCH_LIMITS.maxBytes <= 8 * 1024 * 1024);
  assert.ok(DEFAULT_FETCH_LIMITS.timeoutMs > 0 && DEFAULT_FETCH_LIMITS.timeoutMs <= 30_000);
  assert.ok(DEFAULT_FETCH_LIMITS.maxRedirects >= 1 && DEFAULT_FETCH_LIMITS.maxRedirects <= 5);
});

test('only readable page types are accepted', () => {
  assert.equal(isReadableContentType('text/html; charset=utf-8'), true);
  assert.equal(isReadableContentType('application/xhtml+xml'), true);
  assert.equal(isReadableContentType('text/plain'), true);
  assert.equal(isReadableContentType('application/pdf'), false);
  assert.equal(isReadableContentType('image/png'), false);
  assert.equal(isReadableContentType('application/octet-stream'), false);
  assert.equal(isReadableContentType(null), false, 'a missing content type is not a readable page');
});
