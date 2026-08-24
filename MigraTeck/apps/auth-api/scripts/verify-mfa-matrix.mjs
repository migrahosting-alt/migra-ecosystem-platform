#!/usr/bin/env node
/**
 * Live acceptance matrix for MFA steps 4–8, run against a DEPLOYED environment.
 *
 * WHY THIS EXISTS AS A SCRIPT. The MFA hole was not visible to the unit suite:
 * both login paths issued a real session cookie BEFORE the second factor, and
 * that cookie satisfied every guard in the service. Measured on production with
 * an unanswered challenge pending: /v1/me 200, /v1/me/security 200,
 * /v1/admin/users 200. Only a live session, held in the half-authenticated
 * state, can prove that is closed — so the boundary is asserted here with a real
 * pending cookie, not with a mock.
 *
 * NO HUMAN EVER TYPES A CODE. The enrolment secret comes back from
 * /v1/mfa/totp/enroll, and this process computes its own TOTP from it. The
 * secret and the recovery codes stay in memory for the life of the run: they are
 * never printed, never written to disk, and never put in an environment
 * variable. That is also why the browser legs PAUSE this process rather than
 * splitting it into separate invocations.
 *
 * IDENTITIES. The subject is a DISPOSABLE account (a spare Google or GitHub
 * identity). The operator is a SECOND, separate disposable identity, and only
 * that user id goes in AUTH_ADMIN_USER_IDS. Neither is the owner's production
 * identity — this matrix enrols, promotes, burns a recovery code and disables,
 * and none of that belongs on a real account.
 *
 * Usage:
 *   node scripts/verify-mfa-matrix.mjs                      # preflight only, safe, no identity
 *   node scripts/verify-mfa-matrix.mjs --full               # full 4–8, pauses for browser legs
 *   node scripts/verify-mfa-matrix.mjs --full https://auth.migrateck.com
 *
 * Cookies are supplied on stdin when the run pauses. Capture them from the
 * browser after the disposable identity signs in.
 */

import { argv, exit, stdin, stdout } from 'node:process';
import { createHmac } from 'node:crypto';
import { createInterface } from 'node:readline';

const args = argv.slice(2);
const FULL = args.includes('--full');
const BASE = (args.find((a) => a.startsWith('http')) ?? 'https://auth.migrateck.com').replace(/\/+$/, '');
const SESSION_COOKIE = 'migrateck_auth_session';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const skip = (name, why) => {
  results.push({ name, ok: true, skipped: true, detail: why });
  console.log(`· ${name} — SKIPPED (${why})`);
};

/* ── TOTP, client side ────────────────────────────────────────────────────────
 * The server stores a raw secret and hands out its base32 form, so this decodes
 * base32 and runs RFC 6238 with the server's own parameters: SHA-1, 6 digits,
 * 30s. Self-tested against the RFC vectors below before it is trusted.
 */
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`not base32: ${char}`);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(base32Secret, atMs = Date.now(), stepOffset = 0) {
  const counter = Math.floor(atMs / 1000 / 30) + stepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', base32Decode(base32Secret)).update(counterBuf).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return (code % 1e6).toString().padStart(6, '0');
}

/*
 * A WRONG CODE MUST BE WRONG ON PURPOSE. Mutating one digit can land on the
 * adjacent step the server accepts (TOTP_WINDOW = 1), which would make a
 * "rejects an invalid code" check pass for the wrong reason. This walks far
 * enough out of the drift window that it cannot be a valid code.
 */
const wrongCode = (secret) => totp(secret, Date.now(), 500);

/* ── HTTP ─────────────────────────────────────────────────────────────────── */
async function call(method, path, { cookie, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON is a fact, not a crash */ }
  const setCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  return { status: response.status, json, text, setCookie };
}

const errorCode = (r) => r.json?.error?.code ?? null;
const refused = (r) => r.status === 401 || r.status === 403;

const rl = () => createInterface({ input: stdin, output: stdout });
function ask(question) {
  const io = rl();
  return new Promise((resolve) => io.question(question, (answer) => { io.close(); resolve(answer.trim()); }));
}

/* ══ 0. SELF-TEST — the generator is trusted only if the RFC vectors pass ════ */
{
  // RFC 6238 appendix B, SHA-1: secret "12345678901234567890" in base32.
  const RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const vectors = [[59000, '287082'], [1111111109000, '081804'], [1234567890000, '005924']];
  const ok = vectors.every(([ms, expected]) => totp(RFC, ms) === expected);
  record('TOTP generator matches the RFC 6238 vectors', ok,
    ok ? 'sha1/6/30s' : 'the generator is wrong — every code below would be meaningless');
  if (!ok) { console.error('\nrefusing to run a matrix on a broken code generator'); exit(1); }
}

/* ══ PREFLIGHT — no identity, no state change, safe on production ═══════════ */
{
  const anon = await call('POST', '/v1/mfa/totp/enroll');
  record('enrol refuses an anonymous caller', refused(anon), `status=${anon.status}`);

  const anonVerify = await call('POST', '/v1/mfa/totp/verify', { body: { code: '000000' } });
  record('verify refuses an anonymous caller', refused(anonVerify), `status=${anonVerify.status}`);

  const anonDisable = await call('POST', '/v1/mfa/disable', { body: { code: '000000' } });
  record('disable refuses an anonymous caller', refused(anonDisable), `status=${anonDisable.status}`);

  /*
   * THE STALE-CLIENT SIGNATURE. A present-but-invalid cookie is what made
   * /authorize throw when the generated Prisma client did not know the new
   * session column. 5xx here means a dependency of authentication is broken
   * again; 401 means the session was evaluated and rejected, which is the job.
   */
  const garbage = await call('POST', '/v1/mfa/totp/enroll', { cookie: 'deliberately-not-a-real-session' });
  record('a present-but-invalid session cookie is rejected, never 5xx', garbage.status < 500 && refused(garbage),
    `status=${garbage.status}`);

  /*
   * THE OPEN ADMIN SURFACE. /v1/admin/* was guarded by "is signed in" alone.
   * Anonymous must never be 200 here, whatever else changes.
   */
  const admin = await call('GET', '/v1/admin/users');
  record('/v1/admin/users is closed to anonymous callers', admin.status !== 200, `status=${admin.status}`);
}

if (!FULL) {
  console.log('\nPreflight only. Steps 4–8 need the two disposable identities; re-run with --full.');
}

/* ══ STEPS 4–8 — needs the disposable subject ══════════════════════════════ */
if (FULL) {
  console.log(`
──────────────────────────────────────────────────────────────────────────────
STEP 4 — enrol MFA cleanly on the DISPOSABLE subject.

Sign the disposable identity in at ${BASE}/login (Google or GitHub), then paste
its ${SESSION_COOKIE} cookie value. This account will be enrolled, promoted,
have a recovery code burned, and be disabled again. Do not use a real account.
──────────────────────────────────────────────────────────────────────────────`);
  const subject = await ask('subject session cookie: ');
  if (!subject) { console.error('no cookie given — cannot run 4–8'); exit(1); }

  const who = await call('GET', '/v1/me', { cookie: subject });
  record('subject cookie is a fully authenticated session', who.status === 200,
    `status=${who.status} user=${who.json?.user?.id ?? who.json?.id ?? 'unknown'}`);
  if (who.status !== 200) { console.error('\nthe subject session is not usable — stopping'); exit(1); }

  const before = await call('GET', '/v1/me/security', { cookie: subject });
  if (before.json?.mfa_enabled) {
    console.error('\nthe subject already has MFA enabled — disable it first so step 4 starts clean');
    exit(1);
  }

  /* ── 4. enrolment ─────────────────────────────────────────────────────── */
  const enroll = await call('POST', '/v1/mfa/totp/enroll', { cookie: subject });
  const secret = enroll.json?.secret;
  const recoveryCodes = enroll.json?.recovery_codes ?? [];
  record('4 · enrol issues a challenge, a secret and recovery codes',
    enroll.status === 200 && !!secret && recoveryCodes.length > 0,
    `status=${enroll.status} codes=${recoveryCodes.length}`);
  if (!secret) { console.error('\nno secret returned — stopping'); exit(1); }

  /*
   * THE AUTHENTICATOR ENTRY NAMES THE PRODUCT. Asserted structurally: the label
   * is issuer-prefixed AND the issuer parameter agrees, because authenticators
   * compare the two and a mismatch shows the wrong name.
   */
  const uri = enroll.json?.otpauth_uri ?? '';
  const issuerParam = new URLSearchParams(uri.split('?')[1] ?? '').get('issuer');
  const label = decodeURIComponent((uri.split('?')[0] ?? '').replace('otpauth://totp/', ''));
  record('4 · the otpauth entry is issuer-prefixed and self-consistent',
    !!issuerParam && label.startsWith(`${issuerParam}:`),
    `issuer=${issuerParam ?? 'none'}`);

  /*
   * A RECOVERY CODE CANNOT CONFIRM AN ENROLMENT. Confirming has to prove the
   * authenticator works; a code issued by this very enrolment proves nothing.
   */
  const recoveryAtEnrol = await call('POST', '/v1/mfa/totp/verify', {
    cookie: subject,
    body: { recoveryCode: recoveryCodes[0] },
  });
  record('4 · a recovery code is refused as enrolment confirmation',
    recoveryAtEnrol.status === 400 && errorCode(recoveryAtEnrol) === 'recovery_code_not_applicable',
    `status=${recoveryAtEnrol.status} code=${errorCode(recoveryAtEnrol)}`);

  const bad = await call('POST', '/v1/mfa/totp/verify', {
    cookie: subject,
    body: { code: wrongCode(secret), challenge_id: enroll.json?.challenge_id },
  });
  record('4 · an out-of-window code is rejected', bad.status === 401 && errorCode(bad) === 'invalid_code',
    `status=${bad.status} code=${errorCode(bad)}`);

  const confirm = await call('POST', '/v1/mfa/totp/verify', {
    cookie: subject,
    body: { code: totp(secret), challenge_id: enroll.json?.challenge_id },
  });
  record('4 · the correct code confirms the enrolment', confirm.status === 200 && confirm.json?.verified === true,
    `status=${confirm.status}`);

  const security = await call('GET', '/v1/me/security', { cookie: subject });
  record('4 · /v1/me/security reports MFA enabled', security.json?.mfa_enabled === true,
    `mfa_enabled=${security.json?.mfa_enabled}`);

  const reEnroll = await call('POST', '/v1/mfa/totp/enroll', { cookie: subject });
  record('4 · a second enrolment is refused while one is active',
    reEnroll.status === 409 && errorCode(reEnroll) === 'already_enrolled',
    `status=${reEnroll.status} code=${errorCode(reEnroll)}`);

  /* ── 5/6. the half session, per provider ──────────────────────────────── */
  const promoted = [];
  for (const provider of ['Google', 'GitHub']) {
    console.log(`
──────────────────────────────────────────────────────────────────────────────
STEP 5/6 — ${provider}.

In a CLEAN browser profile, sign the disposable identity in with ${provider}.
It must land on ${BASE}/mfa — that redirect is the fix for social sign-in never
asking for the factor. STOP THERE, answer nothing, and paste the
${SESSION_COOKIE} cookie the half-authenticated session was given.

Press enter with no value to skip ${provider}.
──────────────────────────────────────────────────────────────────────────────`);
    const pending = await ask(`${provider} pending session cookie: `);
    if (!pending) { skip(`5 · ${provider} half-session boundary`, 'no cookie supplied'); continue; }

    /*
     * THE DEFECT, ASSERTED DIRECTLY. These four returned 200 on production with
     * a challenge outstanding. Enforcement now lives in validateSession, so a
     * pending session must be refused EVERYWHERE, not just on the redirect.
     */
    for (const [path, what] of [
      ['/v1/me', 'identity'],
      ['/v1/me/security', 'security state'],
      ['/v1/admin/users', 'the admin surface'],
      ['/v1/sessions', 'the session list'],
    ]) {
      const r = await call('GET', path, { cookie: pending });
      record(`5 · ${provider}: a pending session cannot reach ${what} (${path})`, r.status !== 200,
        `status=${r.status}`);
    }

    const promote = await call('POST', '/v1/mfa/totp/verify', { cookie: pending, body: { code: totp(secret) } });
    record(`6 · ${provider}: the correct code promotes the half session`,
      promote.status === 200 && promote.json?.verified === true, `status=${promote.status}`);
    /*
     * The refresh token is DENIED until the factor is proved, so its arrival is
     * the observable difference between a half session and a real one.
     */
    record(`6 · ${provider}: promotion issues the refresh token it was denied`,
      promote.setCookie.some((c) => c.includes('refresh')),
      promote.setCookie.length ? 'set-cookie present' : 'no set-cookie');

    const afterPromote = await call('GET', '/v1/me', { cookie: pending });
    record(`6 · ${provider}: the same session now reaches /v1/me`, afterPromote.status === 200,
      `status=${afterPromote.status}`);

    /*
     * PROMOTION IS CONDITIONAL AND CANNOT BE REPLAYED — updateMany matching zero
     * rows is a 409, not a success. A "verified" answer here would hand back a
     * session whose state nobody actually changed.
     */
    const replay = await call('POST', '/v1/mfa/totp/verify', { cookie: pending, body: { code: totp(secret) } });
    record(`6 · ${provider}: promotion cannot be replayed`,
      replay.status !== 200 || errorCode(replay) === 'session_not_pending',
      `status=${replay.status} code=${errorCode(replay) ?? 'none'}`);

    promoted.push(provider);
  }
  record('5 · both providers challenge for MFA', promoted.length === 2, `verified=${promoted.join('+') || 'none'}`);

  /* ── 7. the recovery-code path ────────────────────────────────────────── */
  console.log(`
──────────────────────────────────────────────────────────────────────────────
STEP 7 — recovery code.

Sign in again in a clean profile so a NEW challenge is pending, then paste that
cookie. This leg is the one that was completely broken: the page posts
\`recoveryCode\`, the schema demanded a six-digit \`code\`, so every attempt by
someone who had lost their authenticator was rejected as malformed.
──────────────────────────────────────────────────────────────────────────────`);
  const recoveryPending = await ask('pending session cookie for the recovery leg: ');
  let burned = null;
  if (!recoveryPending) {
    skip('7 · recovery code answers a login challenge', 'no cookie supplied');
  } else {
    burned = recoveryCodes[1];
    const used = await call('POST', '/v1/mfa/totp/verify', {
      cookie: recoveryPending,
      body: { recoveryCode: burned },
    });
    record('7 · a recovery code answers a login challenge', used.status === 200 && used.json?.verified === true,
      `status=${used.status}`);
    record('7 · the recovery promotion issues a refresh token',
      used.setCookie.some((c) => c.includes('refresh')),
      used.setCookie.length ? 'set-cookie present' : 'no set-cookie');
    const reachable = await call('GET', '/v1/me', { cookie: recoveryPending });
    record('7 · the recovered session is fully usable', reachable.status === 200, `status=${reachable.status}`);
  }

  if (burned) {
    console.log(`
──────────────────────────────────────────────────────────────────────────────
STEP 7 — single use. Sign in once more for a fresh challenge and paste that
cookie; the SAME recovery code must now be refused.
──────────────────────────────────────────────────────────────────────────────`);
    const reusePending = await ask('pending session cookie for the reuse check: ');
    if (!reusePending) skip('7 · a used recovery code cannot be reused', 'no cookie supplied');
    else {
      const reuse = await call('POST', '/v1/mfa/totp/verify', {
        cookie: reusePending,
        body: { recoveryCode: burned },
      });
      record('7 · a used recovery code cannot be reused',
        reuse.status === 401 && errorCode(reuse) === 'invalid_code',
        `status=${reuse.status} code=${errorCode(reuse)}`);
      /* Leave that session promoted so the run does not strand a half session. */
      await call('POST', '/v1/mfa/totp/verify', { cookie: reusePending, body: { code: totp(secret) } });
    }
  }

  /* ── 8. disable, and no lockout left behind ───────────────────────────── */
  const wrongDisable = await call('POST', '/v1/mfa/disable', { cookie: subject, body: { code: wrongCode(secret) } });
  record('8 · disable refuses an unproven request',
    wrongDisable.status === 401 && errorCode(wrongDisable) === 'reauthentication_failed',
    `status=${wrongDisable.status} code=${errorCode(wrongDisable)}`);
  record('8 · the refusal does not disclose which credential was wrong',
    !/password/i.test(wrongDisable.json?.error?.message ?? '') ||
      /password, an authenticator code, or a recovery code/i.test(wrongDisable.json?.error?.message ?? ''),
    'message is credential-agnostic');

  /*
   * THE ONE-WAY DOOR. A provider-only account has no PASSWORD credential, so
   * when disable accepted only a password it was unreachable for exactly the
   * accounts most likely to use a provider. A TOTP code must authorise it.
   */
  const disable = await call('POST', '/v1/mfa/disable', { cookie: subject, body: { code: totp(secret) } });
  record('8 · a provider-only account can disable with a TOTP code (no password)',
    disable.status === 200 && disable.json?.success === true, `status=${disable.status}`);

  const after = await call('GET', '/v1/me/security', { cookie: subject });
  record('8 · /v1/me/security reports MFA disabled', after.json?.mfa_enabled === false,
    `mfa_enabled=${after.json?.mfa_enabled}`);
  record('8 · the account keeps a way in after disabling', (after.json?.sign_in_methods ?? 0) >= 1,
    `sign_in_methods=${after.json?.sign_in_methods}`);

  const reEnrolAfter = await call('POST', '/v1/mfa/totp/enroll', { cookie: subject });
  record('8 · MFA can be enrolled again after a disable (no stranded credential)',
    reEnrolAfter.status === 200, `status=${reEnrolAfter.status}`);
  if (reEnrolAfter.status === 200) {
    await call('POST', '/v1/mfa/disable', { cookie: subject, body: { code: totp(reEnrolAfter.json.secret) } });
  }

  console.log(`
──────────────────────────────────────────────────────────────────────────────
STEP 8 — the browser leg HTTP cannot prove: sign the disposable identity in
once more with Google and once with GitHub. Both must go straight through with
NO /mfa redirect. Record the result yourself; this script will not claim it.
──────────────────────────────────────────────────────────────────────────────`);
}

/* ══ OPERATOR RECOVERY — the second disposable identity ════════════════════ */
if (FULL) {
  console.log(`
──────────────────────────────────────────────────────────────────────────────
OPERATOR — the SECOND disposable identity, and only its user id in
AUTH_ADMIN_USER_IDS. Paste its session cookie, or press enter to skip.
──────────────────────────────────────────────────────────────────────────────`);
  const operator = await ask('operator session cookie: ');
  if (!operator) skip('operator · the admin allowlist is enforced', 'no operator cookie supplied');
  else {
    const allowed = await call('GET', '/v1/admin/users', { cookie: operator });
    record('operator · the allowlisted operator reaches /v1/admin/users', allowed.status === 200,
      `status=${allowed.status}`);
  }
}

/* ── verdict ──────────────────────────────────────────────────────────────── */
const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
console.log(`\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} checks passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
if (failed.length > 0) {
  console.error('\nMFA MATRIX FAILED — do not close steps 4–8.');
  exit(1);
}
if (skipped.length > 0) {
  console.error('\nMatrix INCOMPLETE — skipped legs are not passes.');
  exit(2);
}
