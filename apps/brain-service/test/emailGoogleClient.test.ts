/**
 * TALKING TO GOOGLE — and classifying what comes back.
 *
 * The classification is the point. `invalid_grant` means the user revoked
 * access and the remedy is to reconnect; everything else means Google is
 * having a bad day and the remedy is to wait. Getting that backwards would,
 * during an outage, mark every connected user's grant as revoked and tell them
 * all to reconnect — which cannot work while Google is down.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exchangeCode,
  identifyAccount,
  knownScopes,
  refreshAccessToken,
  revokeGrant,
  type GoogleClientDeps,
} from '../src/engine/email/googleOAuthClient.js';
import { GOOGLE_SCOPES, ENV, oauthConfigFrom } from '../src/engine/email/oauthConfig.js';

const SECRET = 'GOCSPX-the-client-secret';
const CODE = '4/0AbCdTheAuthorizationCode';

const configResult = oauthConfigFrom({
  [ENV.clientId]: 'client-123.apps.googleusercontent.com',
  [ENV.clientSecret]: SECRET,
  [ENV.publicOrigin]: 'https://chat.example.com',
});
assert.equal(configResult.ok, true);
const config = (configResult as { ok: true; config: { clientId: string; hasSecret: boolean; redirectUri: string } }).config;

const NOW = 1_000_000;

function client(
  respond: (url: string, init?: RequestInit) => Promise<Response> | Response,
  over: Partial<GoogleClientDeps> = {},
): GoogleClientDeps {
  return {
    config,
    clientSecret: () => SECRET,
    fetchImpl: (async (url, init) => respond(String(url), init as RequestInit)) as typeof fetch,
    now: () => NOW,
    ...over,
  };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* ------------------------------------------------------------------ *
 * Exchange
 * ------------------------------------------------------------------ */

test('an exchange returns a grant, with expiry converted from seconds', async () => {
  const grant = await exchangeCode(CODE, client(() =>
    json(200, {
      access_token: 'ya29.access',
      refresh_token: '1//refresh',
      expires_in: 3599,
      scope: GOOGLE_SCOPES.read,
    })));
  assert.equal(grant.accessToken, 'ya29.access');
  assert.equal(grant.refreshToken, '1//refresh');
  assert.equal(grant.expiresAt, NOW + 3_599_000, 'expires_in was not read as seconds');
  assert.deepEqual(grant.grantedScopes, [GOOGLE_SCOPES.read]);
});

test('🚨 a missing expires_in is treated as ALREADY EXPIRED, not as forever', async () => {
  /*
   * An eternal token would never be refreshed and would fail mid-request, as a
   * provider error, repeatedly. Expiring immediately just refreshes once.
   */
  const grant = await exchangeCode(CODE, client(() => json(200, { access_token: 'ya29.a' })));
  assert.equal(grant.expiresAt, NOW);
});

test('🚨 an exchange failure carries NO code, NO secret and NO Google message', async () => {
  /*
   * A token endpoint's error body routinely echoes the request — which holds
   * both the authorization code and the client secret.
   */
  const body = { error: 'invalid_grant', error_description: `code=${CODE} client_secret=${SECRET}` };
  await assert.rejects(
    exchangeCode(CODE, client(() => json(400, body))),
    (error: Error) => {
      const text = `${error.message}\n${error.stack ?? ''}`;
      assert.ok(!text.includes(SECRET), 'the client secret leaked through an exchange failure');
      assert.ok(!text.includes(CODE), 'the authorization code leaked through an exchange failure');
      assert.ok(!text.includes('invalid_grant'), 'a provider error code leaked');
      return true;
    },
  );
});

test('🚨 a THROWN fetch does not propagate the request that carried the secret', async () => {
  await assert.rejects(
    exchangeCode(CODE, client(() => { throw new Error(`connect ECONNREFUSED body=client_secret=${SECRET}`); })),
    (error: Error) => {
      assert.ok(!`${error.message}${error.stack ?? ''}`.includes(SECRET), 'the secret leaked through a transport error');
      return true;
    },
  );
});

test('the secret is sent in the body, never in the URL', async () => {
  let seenUrl = '';
  let seenBody = '';
  await exchangeCode(CODE, client((url, init) => {
    seenUrl = url;
    seenBody = String(init?.body ?? '');
    return json(200, { access_token: 'a', expires_in: 10 });
  }));
  assert.ok(!seenUrl.includes(SECRET), 'the client secret was placed in a URL');
  assert.ok(seenBody.includes(encodeURIComponent(SECRET)) || seenBody.includes(SECRET));
});

/* ------------------------------------------------------------------ *
 * 🚨 Refresh classification
 * ------------------------------------------------------------------ */

test('🚨 invalid_grant is the ONLY response that marks a grant dead', async () => {
  const dead = await refreshAccessToken('1//r', client(() => json(400, { error: 'invalid_grant' })));
  assert.deepEqual(dead, { kind: 'invalid_grant' });
});

test('🚨 an outage, a timeout and an unrecognised 400 all mean UNAVAILABLE', async () => {
  /*
   * Failing towards "try again" rather than towards "your connection is dead".
   * The cost of being wrong runs one way: a misclassified outage tells every
   * user to reconnect during the one period when reconnecting cannot work.
   */
  const cases: Array<[string, () => Response]> = [
    ['500', () => json(500, {})],
    ['502 with no body', () => new Response('gateway', { status: 502 })],
    ['unrecognised 400', () => json(400, { error: 'slow_down' })],
    ['400 with no error field', () => json(400, {})],
    ['200 with no token', () => json(200, { scope: GOOGLE_SCOPES.read })],
  ];
  for (const [name, respond] of cases) {
    const outcome = await refreshAccessToken('1//r', client(respond));
    assert.deepEqual(outcome, { kind: 'unavailable' }, `${name} was not classified as unavailable`);
  }

  const thrown = await refreshAccessToken('1//r', client(() => { throw new Error('ETIMEDOUT'); }));
  assert.deepEqual(thrown, { kind: 'unavailable' }, 'a transport failure was not classified as unavailable');
});

test('🚨 a refresh that OMITS scope does not report an empty grant', async () => {
  /*
   * Google usually omits `scope` on refresh. An empty array would read as
   * "everything was withdrawn" and break every connection on its first refresh.
   */
  const outcome = await refreshAccessToken('1//r', client(() => json(200, { access_token: 'a', expires_in: 100 })));
  assert.equal(outcome.kind, 'refreshed');
  if (outcome.kind === 'refreshed') {
    assert.equal(outcome.grantedScopes, undefined, 'an omitted scope list became an empty grant');
  }
});

test('a refresh that STATES scope reports it', async () => {
  const outcome = await refreshAccessToken('1//r', client(() =>
    json(200, { access_token: 'a', expires_in: 100, scope: `${GOOGLE_SCOPES.read} ${GOOGLE_SCOPES.send}` })));
  assert.equal(outcome.kind, 'refreshed');
  if (outcome.kind === 'refreshed') {
    assert.deepEqual(outcome.grantedScopes, [GOOGLE_SCOPES.read, GOOGLE_SCOPES.send]);
  }
});

test('a missing client secret is unavailability, not a dead grant', async () => {
  // A deployment misconfiguration must not be recorded as the user revoking
  // access — the row would be marked expired and the evidence lost.
  const outcome = await refreshAccessToken('1//r', client(() => json(200, {}), { clientSecret: () => undefined }));
  assert.deepEqual(outcome, { kind: 'unavailable' });
});

test('unknown scope strings are dropped rather than carried through', () => {
  // grantedScopes decides what the product may do; an unrecognised string
  // there is dead weight at best and a false permission at worst.
  assert.deepEqual(knownScopes(`${GOOGLE_SCOPES.read} https://example.com/made-up`), [GOOGLE_SCOPES.read]);
  assert.deepEqual(knownScopes(undefined), []);
});

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

test('🚨 the STABLE id identifies the account; the address is display only', async () => {
  const identity = await identifyAccount('ya29.a', client(() => json(200, { sub: '11223344', email: 'alice@example.com' })));
  assert.deepEqual(identity, { providerAccountId: '11223344', accountAddress: 'alice@example.com' });
});

test('🚨 a response with no stable id is REFUSED, not filled in from the address', async () => {
  /*
   * Falling back to the email address would key the connection on a value the
   * user can change, and the failure would appear months later as a mailbox
   * bound to the wrong person.
   */
  await assert.rejects(
    identifyAccount('ya29.a', client(() => json(200, { email: 'alice@example.com' }))),
    /could not be identified/,
  );
});

test('an identity lookup sends the token as a bearer header, not a query parameter', async () => {
  let seenUrl = '';
  let auth: string | undefined;
  await identifyAccount('ya29.secret-token', client((url, init) => {
    seenUrl = url;
    auth = new Headers(init?.headers).get('authorization') ?? undefined;
    return json(200, { sub: 's', email: 'e@x' });
  }));
  assert.ok(!seenUrl.includes('ya29.secret-token'), 'an access token was placed in a URL, where it is logged');
  assert.equal(auth, 'Bearer ya29.secret-token');
});

test('a failed identity lookup does not propagate the provider message', async () => {
  await assert.rejects(
    identifyAccount('ya29.a', client(() => json(401, { error: 'invalid_token', detail: 'ya29.a is bad' }))),
    (error: Error) => {
      assert.ok(!error.message.includes('ya29.a'), 'an access token leaked through an identity failure');
      return true;
    },
  );
});

/* ------------------------------------------------------------------ *
 * Revocation
 * ------------------------------------------------------------------ */

test('🚨 a 400 from revoke counts as CONFIRMED — an unknown token opens nothing', async () => {
  /*
   * Google answers 400 for a token it does not recognise, which is exactly the
   * state revocation is for. Treating it as a failure would tell users to go
   * and remove an access grant that no longer exists.
   */
  assert.equal(await revokeGrant('1//r', client(() => new Response('', { status: 200 }))), true);
  assert.equal(await revokeGrant('1//r', client(() => new Response('', { status: 400 }))), true);
});

test('a revoke that fails or throws reports FALSE rather than throwing', async () => {
  // The caller deletes our stored authorization either way; a throw here would
  // leave a row the user asked to remove.
  assert.equal(await revokeGrant('1//r', client(() => new Response('', { status: 500 }))), false);
  assert.equal(await revokeGrant('1//r', client(() => { throw new Error('network'); })), false);
});

test('the token being revoked is sent in the body, not the URL', async () => {
  let seenUrl = '';
  await revokeGrant('1//the-refresh-token', client((url) => {
    seenUrl = url;
    return new Response('', { status: 200 });
  }));
  assert.ok(!seenUrl.includes('1//the-refresh-token'), 'a refresh token was placed in a URL, where it is logged');
});
