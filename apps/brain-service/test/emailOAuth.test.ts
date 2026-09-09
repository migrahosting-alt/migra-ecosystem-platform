/**
 * THE OAUTH FLOW — config, authorization, and the callback.
 *
 * The attack this is shaped around is concrete, not abstract: someone gets a
 * victim's browser to complete a callback carrying the ATTACKER'S
 * authorization code. If it is accepted, the victim's Migra account is
 * connected to the attacker's mailbox — every "my email" question then reads
 * the attacker's inbox, and anything drafted goes out from it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CALLBACK_PATH,
  ENV,
  configProblemMessage,
  expectedRedirectUri,
  googleConsoleSetup,
  oauthConfigFrom,
  scopesFor,
} from '../src/engine/email/oauthConfig.js';
import {
  authorizationUrl,
  callbackRefusalMessage,
  completeCallback,
  mintState,
  safeReturnTo,
  stateMatches,
  tokenRequestBody,
  type CallbackDeps,
  type PendingAuthorization,
  type TokenGrant,
} from '../src/engine/email/oauthFlow.js';

const ENVIRONMENT = {
  [ENV.clientId]: 'client-123.apps.googleusercontent.com',
  [ENV.clientSecret]: 'GOCSPX-not-a-real-secret',
  [ENV.publicOrigin]: 'https://chat.example.com',
};

const config = () => {
  const result = oauthConfigFrom(ENVIRONMENT);
  assert.equal(result.ok, true);
  return (result as { ok: true; config: ReturnType<typeof Object> }).ok
    ? (result as unknown as { config: { clientId: string; hasSecret: boolean; redirectUri: string } }).config
    : (undefined as never);
};

/* ------------------------------------------------------------------ *
 * 🚨 The redirect URI is canonical HERE
 * ------------------------------------------------------------------ */

test('🚨 the redirect URI is derived from config, with an exact shape', () => {
  /*
   * This is the value a human transcribes into the Google console. It is
   * asserted exactly so a change to it is a deliberate act with a visible
   * diff — rather than the console becoming the source of truth and the code a
   * copy that drifts.
   */
  assert.equal(config().redirectUri, 'https://chat.example.com/api/account/mail/callback');
  assert.equal(expectedRedirectUri('https://chat.example.com'), 'https://chat.example.com/api/account/mail/callback');
  assert.equal(CALLBACK_PATH, '/api/account/mail/callback');
});

test('no production hostname is hardcoded in app logic', () => {
  // A hardcoded host would make staging redirect users into production, and
  // make the value unchangeable without a code release.
  assert.equal(expectedRedirectUri('https://staging.example.org'), 'https://staging.example.org/api/account/mail/callback');
});

test('🚨 the Google Cloud console values are GENERATED, and asserted exactly', () => {
  /*
   * These two strings are what a human types into the console. Generating them
   * from the same constant the callback route uses is what stops the console
   * becoming the source of truth and the code a copy of it — a drift whose
   * first symptom is a user's sign-in bouncing with redirect_uri_mismatch.
   */
  assert.deepEqual(googleConsoleSetup('https://chat.example.com'), {
    authorizedRedirectUri: 'https://chat.example.com/api/account/mail/callback',
    authorizedJavaScriptOrigin: 'https://chat.example.com',
  });
  // Google rejects a JavaScript origin carrying a path or a trailing slash.
  assert.ok(!googleConsoleSetup('https://chat.example.com').authorizedJavaScriptOrigin.endsWith('/'));
  // And the redirect the running server would actually receive matches it.
  assert.equal(
    googleConsoleSetup('https://chat.example.com').authorizedRedirectUri,
    config().redirectUri,
  );
});

test('🚨 http on LOCALHOST is refused in production, and allowed outside it', () => {
  /*
   * Google accepts http://localhost for a web client, so local development
   * genuinely needs it. A production deployment that fell back to it would
   * send every user's consent redirect to their own machine, where nothing is
   * listening — and it would look like Google rejecting the app rather than a
   * misconfiguration.
   */
  const local = { ...ENVIRONMENT, [ENV.publicOrigin]: 'http://localhost:3000' };
  assert.equal(oauthConfigFrom({ ...local, NODE_ENV: 'development' }).ok, true);
  assert.equal(oauthConfigFrom({ ...local, NODE_ENV: 'production' }).ok, false, 'localhost was accepted in production');
  // The exception is localhost ONLY — not any http host, in either mode.
  assert.equal(oauthConfigFrom({ ...ENVIRONMENT, [ENV.publicOrigin]: 'http://chat.example.com', NODE_ENV: 'development' }).ok, false);
  // And an unset NODE_ENV is not production, so a dev shell still works.
  assert.equal(oauthConfigFrom(local).ok, true);
});

test('🚨 a non-HTTPS origin is refused at CONFIG time', () => {
  /*
   * Google refuses non-HTTPS web redirect URIs. Catching it here turns a
   * redirect_uri_mismatch at a user's sign-in into a startup complaint.
   */
  const result = oauthConfigFrom({ ...ENVIRONMENT, [ENV.publicOrigin]: 'http://chat.example.com' });
  assert.equal(result.ok, false);
});

test('🚨 an origin carrying a PATH is refused', () => {
  // It would silently produce https://host/app/api/... — a different URI that
  // would have to be registered separately and would not match.
  for (const bad of ['https://chat.example.com/app', 'https://chat.example.com/?x=1']) {
    assert.equal(oauthConfigFrom({ ...ENVIRONMENT, [ENV.publicOrigin]: bad }).ok, false, `${bad} was accepted`);
  }
});

test('missing configuration NAMES the variables, and refuses rather than throwing', () => {
  // The capability reports "not set up yet" and an operator learns the gap;
  // the process does not fail to boot over a feature nobody enabled.
  const result = oauthConfigFrom({});
  assert.equal(result.ok, false);
  if (!result.ok) {
    const message = configProblemMessage(result.problems);
    assert.match(message, new RegExp(ENV.clientId));
    assert.match(message, new RegExp(ENV.publicOrigin));
  }
});

test('🚨 the config object never carries the secret', () => {
  /*
   * A config object gets logged. `hasSecret` is a boolean for exactly this
   * reason — the value stays in the environment and has one call site.
   */
  const serialised = JSON.stringify(config());
  assert.ok(!serialised.includes('GOCSPX'), 'the client secret is reachable from the config object');
  assert.equal(config().hasSecret, true);
});

/* ------------------------------------------------------------------ *
 * Scopes
 * ------------------------------------------------------------------ */

test('🚨 read is requestable WITHOUT send', () => {
  /*
   * Asking for permission to send mail before the product has shown it can
   * read any is requesting the irreversible permission on a promise.
   */
  const read = scopesFor(['read']);
  assert.deepEqual(read, ['https://www.googleapis.com/auth/gmail.readonly']);
  assert.ok(!read.some((s) => s.includes('send')), 'send scope was requested alongside read');
});

test('scopes are deduplicated and ordered, so equivalent requests match', () => {
  assert.deepEqual(scopesFor(['read', 'read', 'send']), scopesFor(['send', 'read']));
});

/* ------------------------------------------------------------------ *
 * Authorization URL
 * ------------------------------------------------------------------ */

test('the authorization URL asks for offline access and forces consent', () => {
  /*
   * Google issues a refresh token only on the FIRST consent for a client/user
   * pair. Without these, an account reconnecting after a revoke returns with an
   * access token that expires in an hour and no way to renew — a connection
   * that silently dies and looks like a bug.
   */
  const url = new URL(authorizationUrl({ config: config(), state: 'abc', grants: ['read'] }));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://chat.example.com/api/account/mail/callback');
  assert.equal(url.searchParams.get('state'), 'abc');
});

test('state values are unguessable and unique', () => {
  const values = new Set(Array.from({ length: 50 }, () => mintState()));
  assert.equal(values.size, 50);
  assert.ok(mintState().length >= 32);
});

test('state comparison tolerates differing lengths without throwing', () => {
  // A raw timingSafeEqual on unequal lengths throws; hashing first makes the
  // comparison fixed-width and constant-time.
  assert.equal(stateMatches('short', 'a-much-longer-value'), false);
  assert.equal(stateMatches('same', 'same'), true);
});

/* ------------------------------------------------------------------ *
 * 🚨 The callback
 * ------------------------------------------------------------------ */

const pending = (over: Partial<PendingAuthorization> = {}): PendingAuthorization => ({
  state: 'state-1',
  ownerScope: 'user:alice',
  grants: ['read'],
  createdAt: 1_000_000,
  returnTo: '/',
  ...over,
});

const grant: TokenGrant = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 2_000_000,
  grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
};

function deps(over: Partial<CallbackDeps> & { record?: PendingAuthorization | null } = {}): {
  deps: CallbackDeps;
  exchanges: number;
} {
  let stored = over.record === undefined ? pending() : over.record;
  let exchanges = 0;
  const built: CallbackDeps = {
    takePending: async () => {
      const taken = stored;
      stored = null; // Taken, not read — this is what makes state single-use.
      return taken;
    },
    exchange: async () => {
      exchanges += 1;
      return grant;
    },
    now: () => 1_000_100,
    ...over,
  };
  return { deps: built, get exchanges() { return exchanges; } } as { deps: CallbackDeps; exchanges: number };
}

test('a valid callback completes', async () => {
  const h = deps();
  const result = await completeCallback({
    state: 'state-1',
    code: 'code-1',
    error: undefined,
    ownerScope: 'user:alice',
    deps: h.deps,
  });
  assert.equal(result.ok, true);
});

test('🚨 a callback from a DIFFERENT principal never exchanges the code', async () => {
  /*
   * The attack, precisely. The flow was begun by alice; the callback arrives
   * in bob's session carrying an authorization code. Accepting it would connect
   * bob's Migra account to alice's mailbox — or, run the other way, graft an
   * attacker's mailbox onto a victim.
   */
  const h = deps();
  const result = await completeCallback({
    state: 'state-1',
    code: 'code-1',
    error: undefined,
    ownerScope: 'user:bob',
    deps: h.deps,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'principal_mismatch');
  assert.equal(h.exchanges, 0, 'a code was exchanged for a mismatched principal');
});

test('🚨 a replayed state is refused, and costs no exchange', async () => {
  const h = deps({ record: null });
  const result = await completeCallback({
    state: 'state-1',
    code: 'code-1',
    error: undefined,
    ownerScope: 'user:alice',
    deps: h.deps,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'state_replayed');
  assert.equal(h.exchanges, 0);
});

test('an expired attempt is refused', async () => {
  const h = deps({ now: () => 1_000_000 + 11 * 60_000 });
  const result = await completeCallback({
    state: 'state-1',
    code: 'code-1',
    error: undefined,
    ownerScope: 'user:alice',
    deps: h.deps,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'state_expired');
});

test('a missing code or state is refused before anything is contacted', async () => {
  for (const [state, code] of [[undefined, 'c'], ['s', undefined], [undefined, undefined]] as const) {
    const h = deps();
    const result = await completeCallback({ state, code, error: undefined, ownerScope: 'user:alice', deps: h.deps });
    assert.equal(result.ok, false);
    assert.equal(h.exchanges, 0);
  }
});

test('a user pressing Cancel is an ORDINARY outcome, not a fault', async () => {
  const h = deps();
  const result = await completeCallback({
    state: 's',
    code: undefined,
    error: 'access_denied',
    ownerScope: 'user:alice',
    deps: h.deps,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'user_declined');
  assert.match(callbackRefusalMessage({ kind: 'user_declined' }), /cancelled/i);
});

test('an exchange failure does not propagate the exception', async () => {
  const h = deps({
    exchange: async () => {
      throw new Error('400 invalid_grant code=4/0Ab... client_secret=GOCSPX-real');
    },
  });
  const result = await completeCallback({
    state: 'state-1',
    code: 'code-1',
    error: undefined,
    ownerScope: 'user:alice',
    deps: h.deps,
  });
  assert.equal(result.ok, false);
  const serialised = JSON.stringify(result);
  assert.ok(!serialised.includes('GOCSPX'), 'a secret leaked through an exchange failure');
  assert.ok(!serialised.includes('4/0Ab'), 'an authorization code leaked through an exchange failure');
});

test('🚨 forged-callback refusals are INDISTINGUISHABLE to the sender', () => {
  /*
   * Three separate engineering states, one user-facing sentence. Telling a
   * forger which check they failed is a probing oracle.
   */
  const messages = new Set([
    callbackRefusalMessage({ kind: 'state_unknown' }),
    callbackRefusalMessage({ kind: 'state_replayed' }),
    callbackRefusalMessage({ kind: 'principal_mismatch' }),
  ]);
  assert.equal(messages.size, 1, 'the refusals are distinguishable and can be probed');
});

/* ------------------------------------------------------------------ *
 * Open redirect
 * ------------------------------------------------------------------ */

test('🚨 returnTo may only be a same-site path', () => {
  // `//evil.com` is protocol-relative: a browser treats it as absolute and
  // would send the user off-site immediately after connecting their mailbox.
  assert.equal(safeReturnTo('//evil.com'), '/');
  assert.equal(safeReturnTo('https://evil.com/x'), '/');
  assert.equal(safeReturnTo('/chat/abc'), '/chat/abc');
  assert.equal(safeReturnTo(undefined), '/');
});

test('🚨 the BACKSLASH bypass is rejected — it passes a naive prefix check', () => {
  /*
   * `/\evil.com` starts with exactly one slash, so a `startsWith('//')` test
   * waves it through. The URL parser does not: for a special scheme it treats
   * a backslash as a slash, so a browser handed this as a Location goes to
   * evil.com. This is the case that proves the PARSE, not the prefix check,
   * is what actually closes the redirect.
   */
  assert.equal(safeReturnTo('/\\evil.com'), '/');
  assert.equal(safeReturnTo('/\\\\evil.com'), '/');
});

test('a returnTo without a leading slash is refused, not resolved against the callback', () => {
  /*
   * The other half of the guard, isolated. `evil.com` parses as a RELATIVE
   * path, so it stays same-site and the parse check accepts it — but it would
   * resolve against /api/account/mail/, sending the user somewhere nobody
   * intended. Only the prefix check rejects it, which is why both are here.
   */
  assert.equal(safeReturnTo('evil.com'), '/');
  assert.equal(safeReturnTo('chat/abc'), '/');
});

/* ------------------------------------------------------------------ *
 * The secret has one call site
 * ------------------------------------------------------------------ */

test('the token request carries the secret, and nothing else does', () => {
  const body = tokenRequestBody({
    code: 'c',
    clientId: 'id',
    clientSecret: 's',
    redirectUri: 'https://chat.example.com/api/account/mail/callback',
  });
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('client_secret'), 's');
  // And the authorization URL — which reaches the browser — does not.
  const url = authorizationUrl({ config: config(), state: 'x', grants: ['read'] });
  assert.ok(!url.includes('client_secret'), 'the client secret is in a URL the browser receives');
});
