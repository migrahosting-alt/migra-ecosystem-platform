#!/usr/bin/env node
/**
 * `migrapilot-qualify` — the operator entry point for governed model qualification.
 *
 * THE WIRING LIVES HERE, THE DECISIONS LIVE IN `qualifyModel.ts`. Everything that
 * decides whether a mutation is allowed — who the approver is, whether the
 * evidence still matches, what may be signed and for how long — is a pure
 * function with tests. This file only moves bytes between the two authorities:
 * MigraAuth, which says who you are and what you may do, and the Brain, which
 * verifies the signature and records the decision.
 *
 * TWO AUTHORITIES, DELIBERATELY. Neither is sufficient alone. A MigraAuth token
 * without the signing key cannot mutate anything; the signing key without a
 * permitted token has no approver to attribute a decision to, and the Brain
 * refuses an assertion whose approver is missing. That is what stops this from
 * collapsing into "being on the Brain host means you're allowed".
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { argv, env, exit, stdout } from 'node:process';

import {
  CliRefusal, approverFrom, approveRequest, revokeRequest, evidenceRequest,
  evidenceUnchanged, signMutation, confirmationText, askToConfirm, selectKey, readToken,
  requireExplicitOutcome, pkcePair, buildAuthorizeUrl, parseCallback, tokenRequestBody,
  plannedRecords, guidedPlanText, assertOneSubject, recordedMatchesPlan,
  type AdminMeResponse, type EvidenceView, type MutationRequest,
} from './qualifyModel.js';

const AUTH_BASE = (env.MIGRAAUTH_API_URL ?? 'https://auth.migrateck.com').replace(/\/+$/, '');
const BRAIN_BASE = (env.MIGRAPILOT_BRAIN_URL ?? `http://127.0.0.1:${env.MIGRAPILOT_BRAIN_PORT ?? 3988}`).replace(/\/+$/, '');

const CLI_CLIENT_ID = env.MIGRAAUTH_CLI_CLIENT_ID ?? 'migrapilot_qualification_cli';
const CLI_REDIRECT_PORT = Number(env.MIGRAAUTH_CLI_PORT ?? 4747);
const CLI_REDIRECT_URI = `http://127.0.0.1:${CLI_REDIRECT_PORT}/callback`;
const CLI_SCOPES = ['openid', 'profile', 'email'] as const;
const STAGED_EVIDENCE = [
  '/opt/migrapilot/staging/ev-A-full-failed.json',
  '/opt/migrapilot/staging/ev-B-counting-failed.json',
  '/opt/migrapilot/staging/ev-C-scoped-passed.json',
];

const USAGE = `
  migrapilot-qualify — governed model qualification

    guided-approve              sign in, review, record the staged evidence and approve

    whoami                      prove the token and the permission behind it
    status   --capability <c>   what is approved to serve that capability right now
    evidence --model <id> --capability <c>
                                evidence runs recorded for a model, newest first
    show     --evidence <runId> one evidence run in full
    record   --model <id> --capability <c> --suite <name> --results <file.json>
             [--passed|--failed] [--version <v>] [--digest <sha256:…>]
             [--license <name>] [--license-source <url>] [--provider <p>] [--environment <file.json>]
    approve  --model <id> --capability <c> --evidence <runId> [--note <text>]
    revoke   --model <id> --capability <c> --reason <text>

  Requires MIGRAAUTH_TOKEN in the environment (never as an argument) and a
  MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V* for anything that mutates.
`;

// ── argument parsing ──────────────────────────────────────────────────────

type Flags = Record<string, string | true>;

function parseFlags(args: readonly string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) throw new CliRefusal('bad_usage', `Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i += 1;
    }
  }
  return flags;
}

function required(flags: Flags, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CliRefusal('bad_usage', `--${name} is required.`);
  }
  return value;
}

function optional(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ── the two authorities ───────────────────────────────────────────────────

/**
 * Ask MigraAuth who this is.
 *
 * The token is sent as a bearer header and never logged, never echoed, and never
 * written anywhere. On failure the STATUS is reported, not the body: an auth
 * error body can carry back details of the token presented.
 */
async function whoAmI(token: string): Promise<{ approverId: string; email: string | null; viaBootstrap: boolean }> {
  let response: Response;
  try {
    response = await fetch(`${AUTH_BASE}/v1/admin/me`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  } catch (error) {
    throw new CliRefusal('authority_unreachable', `Cannot reach MigraAuth at ${AUTH_BASE}: ${(error as Error).message}`);
  }
  if (response.status === 401) {
    throw new CliRefusal('token_rejected', 'MigraAuth rejected the token. Sign in again and re-export MIGRAAUTH_TOKEN.');
  }
  if (response.status === 404) {
    /*
     * The operator surface answers 404 rather than 403 so it is not discoverable
     * by a non-operator. Read here as what it is: no authority, not a typo.
     */
    throw new CliRefusal('not_permitted', 'This account has no platform authority. It cannot qualify models.');
  }
  if (!response.ok) {
    throw new CliRefusal('authority_error', `MigraAuth answered ${response.status}.`);
  }
  const me = (await response.json()) as AdminMeResponse & { via_bootstrap?: unknown };
  const approver = approverFrom(me);
  return { ...approver, viaBootstrap: me.via_bootstrap === true };
}

async function brainGet(path: string): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${BRAIN_BASE}${path}`, { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new CliRefusal('brain_unreachable', `Cannot reach the Brain at ${BRAIN_BASE}: ${(error as Error).message}`);
  }
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function fetchEvidence(runId: string): Promise<EvidenceView | null> {
  const { status, body } = await brainGet(`/api/ai/model-qualification/evidence/${encodeURIComponent(runId)}`);
  if (status === 404) return null;
  if (status !== 200) throw new CliRefusal('brain_error', `The Brain answered ${status} reading evidence.`);
  const evidence = (body as { evidence?: EvidenceView } | null)?.evidence;
  return evidence ?? null;
}

/**
 * Send one signed mutation.
 *
 * NON-INTERACTIVE AFTER AUTHORIZATION. Once the human has confirmed, this sends
 * exactly the payload they confirmed, once. It does not prompt again, does not
 * retry, and cannot amend the body — a retry would need a fresh nonce, and a
 * prompt after authorization is a second decision made under the first one's
 * approval.
 */
async function sendSigned(request: MutationRequest, approverId: string): Promise<Record<string, unknown> | null> {
  const { keyId, key } = selectKey(env);
  const signed = signMutation({ request, approverId, keyId, key });

  let response: Response;
  try {
    response = await fetch(`${BRAIN_BASE}${request.path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-migrapilot-assertion': signed.assertionHeader,
      },
      body: signed.rawBody,
    });
  } catch (error) {
    throw new CliRefusal('brain_unreachable', `Cannot reach the Brain at ${BRAIN_BASE}: ${(error as Error).message}`);
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.error === 'string' ? body.error : `http_${response.status}`;
    throw new CliRefusal(code, `The Brain refused this: ${code}${body?.message ? ` — ${String(body.message)}` : ''}`);
  }
  return body;
}

// ── operator sign-in (Authorization Code + PKCE over loopback) ────────────

/**
 * Obtain an access token by having a human sign in, and keep it in memory.
 *
 * WHY A BROWSER AT ALL. MigraAuth issues tokens only through
 * `authorization_code` — there is no client-credentials grant, and that is the
 * right shape: a machine credential would let anything holding a file approve a
 * model. The person approving has to be a person.
 *
 * THE TOKEN NEVER LEAVES THIS FUNCTION'S RETURN VALUE. Not argv, not an
 * environment file, not a log line, not disk. It dies with the process, which is
 * also why this client is registered WITHOUT `offline_access`: there is no
 * refresh token to leak, and the next approval requires signing in again.
 *
 * LOOPBACK, NOT A PASTED CODE. The code arrives over 127.0.0.1, so it is never
 * shown to the operator and never transits a terminal that may be recorded.
 */
async function signIn(): Promise<string> {
  let discovery: { authorization_endpoint?: string; token_endpoint?: string };
  try {
    const response = await fetch(`${AUTH_BASE}/.well-known/openid-configuration`);
    if (!response.ok) throw new Error(`discovery answered ${response.status}`);
    discovery = (await response.json()) as typeof discovery;
  } catch (error) {
    throw new CliRefusal('discovery_failed', `Cannot read MigraAuth discovery at ${AUTH_BASE}: ${(error as Error).message}`);
  }
  const authorizeEndpoint = discovery.authorization_endpoint;
  const tokenEndpoint = discovery.token_endpoint;
  if (!authorizeEndpoint || !tokenEndpoint) {
    throw new CliRefusal('discovery_incomplete', 'MigraAuth discovery did not name both endpoints.');
  }

  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('base64url');

  const received = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      // Only the registered path answers; anything else gets nothing useful.
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }
      try {
        const { code } = parseCallback(req.url, state);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
          '<!doctype html><meta charset="utf-8"><title>Signed in</title>' +
          '<body style="font:16px system-ui;padding:3rem;max-width:34rem">' +
          '<h1 style="font-size:1.2rem">Signed in.</h1>' +
          '<p>Return to the terminal to review what will be recorded. ' +
          'Nothing has been written yet.</p>',
        );
        server.close();
        resolve(code);
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          .end('That callback was rejected. Return to the terminal.');
        server.close();
        reject(error);
      }
    });
    server.on('error', (error) => reject(new CliRefusal(
      'loopback_unavailable',
      `Cannot listen on 127.0.0.1:${CLI_REDIRECT_PORT}: ${error.message}. ` +
      'Free the port, or set MIGRAAUTH_CLI_PORT to one registered for this client.',
    )));
    // BOUND TO LOOPBACK EXPLICITLY. A default bind would accept the callback
    // from the network, which is an authorization code arriving from anywhere.
    server.listen(CLI_REDIRECT_PORT, '127.0.0.1');
    setTimeout(() => {
      server.close();
      reject(new CliRefusal('sign_in_timeout', 'No callback arrived within five minutes.'));
    }, 5 * 60_000).unref();
  });

  const url = buildAuthorizeUrl({
    authorizeEndpoint, clientId: CLI_CLIENT_ID, redirectUri: CLI_REDIRECT_URI,
    challenge, state, scopes: CLI_SCOPES,
  });
  stdout.write(`\n  Open this in a browser and sign in as the operator account:\n\n    ${url}\n\n  Waiting for the callback on 127.0.0.1:${CLI_REDIRECT_PORT}…\n`);

  const code = await received;

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenRequestBody({ code, verifier, clientId: CLI_CLIENT_ID, redirectUri: CLI_REDIRECT_URI }),
  });
  if (!response.ok) {
    // The status, never the body: a token-endpoint error can echo the code back.
    throw new CliRefusal('token_exchange_failed', `The token endpoint answered ${response.status}.`);
  }
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new CliRefusal('no_access_token', 'The token endpoint returned no access token.');
  }
  return payload.access_token;
}

/**
 * Sign in, review, record every staged evidence run, approve the one that earned
 * it, and PROVE the registry changed.
 *
 * The last step is not a formality. Recording and approving can both succeed
 * while the running Brain still serves nothing — a stale registry, a different
 * digest, a capability nobody reads. Until the live registry says so, the
 * capability is not enabled, and this exits non-zero rather than report success.
 */
async function guidedApprove(): Promise<void> {
  const token = await signIn();
  const { approverId, email, viaBootstrap } = await whoAmI(token);
  if (viaBootstrap) {
    stdout.write('\n  ⚠ This authority comes from AUTH_ADMIN_USER_IDS, not a real grant.\n');
  }
  stdout.write(`\n  Authenticated as ${approverId}${email ? ` (${email})` : ''}\n`);

  const loaded: { file: string; evidence: Record<string, unknown> }[] = [];
  for (const file of STAGED_EVIDENCE) {
    loaded.push({ file, evidence: (await readJsonFile(file)) as Record<string, unknown> });
  }
  /*
   * IDENTITY COMES FROM THE EVIDENCE, NOT FROM A FLAG OR THE REGISTRY.
   *
   * `plannedRecords` refuses a file that does not state its model, version and a
   * well-formed digest, so by here every record names the exact bytes it
   * measured. Reading the digest from the installed-model registry instead would
   * approve whatever is installed NOW rather than what was actually measured —
   * and a tag can be repointed between the two.
   */
  const plan = plannedRecords(loaded);
  const { modelId, modelVersion: version, modelDigest: digest } = assertOneSubject(plan);

  stdout.write(guidedPlanText({ modelId, version, digest, approverId, approverEmail: email, records: plan }));
  if (!(await askToConfirm('  Type "approve" to sign all of this: '))) {
    stdout.write('  Nothing was signed.\n\n');
    exit(1);
  }

  // ── non-interactive from here. Every write below was covered by that one yes.
  const runIds = new Map<string, string>();
  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i]!;
    const evidence = loaded[i]!.evidence;
    const request = evidenceRequest({
      modelId: step.modelId, capability: step.capability, suite: step.suite, passed: step.passed,
      modelVersion: step.modelVersion, modelDigest: step.modelDigest,
      license: typeof evidence.license === 'string' ? evidence.license : undefined,
      licenseSource: typeof evidence.license_source === 'string' ? evidence.license_source : undefined,
      results: evidence,
    });
    const body = await sendSigned(request, approverId);
    const runId = typeof body?.evidenceRunId === 'string' ? body.evidenceRunId : null;
    if (!runId) throw new CliRefusal('no_run_id', `Recording ${step.capability} returned no evidence run id.`);
    runIds.set(step.capability, runId);
    stdout.write(`  recorded  ${step.passed ? 'PASSED' : 'FAILED'}  ${step.capability}  (${step.suite})  run ${runId}\n`);
  }

  for (const step of plan.filter((p) => p.approve)) {
    const runId = runIds.get(step.capability)!;
    /*
     * RE-READ THE ROW IMMEDIATELY BEFORE SIGNING.
     *
     * The Brain validates independently, but that closes a different gap. This
     * one is between what was planned and displayed and what the store actually
     * holds — a record that landed with a different digest, model or verdict
     * must abort rather than be approved on the strength of what we intended to
     * write.
     */
    const recorded = await fetchEvidence(runId);
    if (!recordedMatchesPlan(step, recorded)) {
      throw new CliRefusal(
        'evidence_mismatch',
        `Run ${runId} does not match what was approved on screen ` +
        `(${step.modelId} ${step.capability} ${step.modelDigest}). Nothing further was signed.`,
      );
    }
    await sendSigned(
      approveRequest({ modelId: step.modelId, capability: step.capability, evidenceRunId: runId }),
      approverId,
    );
    stdout.write(`  APPROVED  ${step.capability}  against run ${runId}\n`);
    stdout.write(`            digest ${step.modelDigest}\n`);
  }

  await proveRegistry(modelId);
}

/**
 * The registry, read from the running Brain, after the writes.
 *
 * An approval that the serving process does not reflect is not a capability.
 * This asserts both halves: the scoped one is live, and the excluded one is
 * still refused — because "counting quietly became qualified" is exactly the
 * outcome the split capability exists to prevent.
 */
async function proveRegistry(modelId: string): Promise<void> {
  const { status, body } = await brainGet('/api/ai/vision-registry');
  if (status !== 200) throw new CliRefusal('registry_unreadable', `The Brain answered ${status} for the registry.`);
  const governed = (body as { governed?: Record<string, { qualified?: boolean; modelId?: string | null }> } | null)?.governed;
  const general = governed?.['vision.general'];
  const counting = governed?.['vision.object_counting'];

  stdout.write('\n  ── LIVE REGISTRY ────────────────────────────────────────────\n');
  stdout.write(`  vision.general          qualified=${general?.qualified === true}  model=${general?.modelId ?? 'none'}\n`);
  stdout.write(`  vision.object_counting  qualified=${counting?.qualified === true}  model=${counting?.modelId ?? 'none'}\n`);

  const ok = general?.qualified === true && general.modelId === modelId && counting?.qualified !== true;
  if (!ok) {
    throw new CliRefusal(
      'registry_not_updated',
      'The writes succeeded but the running registry does not reflect them. Image input must stay disabled.',
    );
  }
  stdout.write('\n  ✓ Image understanding is qualified and live. Counting remains refused.\n\n');
}

// ── commands ──────────────────────────────────────────────────────────────

async function readJsonFile(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8').catch(() => {
    throw new CliRefusal('unreadable_file', `Cannot read ${path}.`);
  });
  try {
    return JSON.parse(raw);
  } catch {
    throw new CliRefusal('invalid_json', `${path} is not valid JSON.`);
  }
}

async function run(command: string, flags: Flags): Promise<void> {
  // Reads need no token: they are ordinary, and gating them would only make
  // looking something up harder than changing it.
  if (command === 'status') {
    const { body } = await brainGet(`/api/ai/model-qualification/${encodeURIComponent(required(flags, 'capability'))}`);
    stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }
  if (command === 'evidence') {
    const { body } = await brainGet(
      `/api/ai/model-qualification/${encodeURIComponent(required(flags, 'capability'))}` +
        `/${encodeURIComponent(required(flags, 'model'))}/evidence`,
    );
    stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }
  if (command === 'show') {
    const evidence = await fetchEvidence(required(flags, 'evidence'));
    if (!evidence) throw new CliRefusal('unknown_evidence', 'No evidence run with that id.');
    stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    return;
  }

  /*
   * The guided path signs a human in itself, so it must come BEFORE the
   * environment-token requirement — the whole point is that no one has to obtain
   * a token by hand.
   */
  if (command === 'guided-approve') {
    await guidedApprove();
    return;
  }

  const token = readToken(env);
  const { approverId, email, viaBootstrap } = await whoAmI(token);

  if (viaBootstrap) {
    /*
     * Loud, but not fatal. Bootstrap authority is how a fresh deployment creates
     * its first real grant; a decision made under it is still attributable, and
     * the Brain records the same approver either way. What must not happen is
     * that it stops being noticed.
     */
    stdout.write('\n  ⚠ This authority comes from AUTH_ADMIN_USER_IDS, not a real grant.\n' +
      '    Grant an OWNER role and unset the env var.\n');
  }

  if (command === 'whoami') {
    stdout.write(`\n  approver   ${approverId}${email ? ` (${email})` : ''}\n  permitted  yes\n\n`);
    return;
  }

  if (command === 'record') {
    const passed = requireExplicitOutcome(flags.passed === true, flags.failed === true);
    const environmentFile = optional(flags, 'environment');
    const request = evidenceRequest({
      modelId: required(flags, 'model'),
      capability: required(flags, 'capability'),
      suite: required(flags, 'suite'),
      passed,
      modelVersion: optional(flags, 'version'),
      modelDigest: optional(flags, 'digest'),
      provider: optional(flags, 'provider'),
      license: optional(flags, 'license'),
      licenseSource: optional(flags, 'license-source'),
      results: await readJsonFile(required(flags, 'results')),
      ...(environmentFile ? { environment: await readJsonFile(environmentFile) } : {}),
    });
    /*
     * Recording is not confirmed, because it grants nothing: evidence is an
     * append-only measurement, and approval — which does grant something — makes
     * the human read that measurement's digest and outcome before deciding.
     */
    const recorded = await sendSigned(request, approverId);
    stdout.write(`\n  accepted — ${JSON.stringify(recorded)}\n\n`);
    return;
  }

  if (command === 'approve') {
    const modelId = required(flags, 'model');
    const capability = required(flags, 'capability');
    const evidenceRunId = required(flags, 'evidence');

    const shown = await fetchEvidence(evidenceRunId);
    if (!shown) throw new CliRefusal('unknown_evidence', 'No evidence run with that id. Approval must point at one.');
    if (shown.modelId !== modelId || shown.capability !== capability) {
      throw new CliRefusal(
        'evidence_mismatch',
        `That evidence is for ${shown.modelId}/${shown.capability}, not ${modelId}/${capability}.`,
      );
    }
    if (!shown.passed) {
      throw new CliRefusal('evidence_failed', 'That run did not pass. A failed measurement cannot justify an approval.');
    }

    stdout.write(confirmationText({
      action: 'approve', evidence: shown, modelId, capability,
      approverId, approverEmail: email, reason: optional(flags, 'note'),
    }));
    const confirmed = await askToConfirm('  Type "approve" to sign this decision: ');
    if (!confirmed) {
      stdout.write('  Not approved. Nothing was signed.\n\n');
      exit(1);
    }

    // The gap between what was READ and what gets SIGNED.
    if (!evidenceUnchanged(shown, await fetchEvidence(evidenceRunId))) {
      throw new CliRefusal(
        'evidence_changed',
        'The evidence changed after it was displayed. Nothing signed — re-read it and decide again.',
      );
    }

    const approved = await sendSigned(
      approveRequest({ modelId, capability, evidenceRunId, note: optional(flags, 'note') }),
      approverId,
    );
    stdout.write(`\n  accepted — ${JSON.stringify(approved)}\n\n`);
    return;
  }

  if (command === 'revoke') {
    const modelId = required(flags, 'model');
    const capability = required(flags, 'capability');
    const reason = required(flags, 'reason');

    stdout.write(confirmationText({
      action: 'revoke', evidence: null, modelId, capability, approverId, approverEmail: email, reason,
    }));
    const confirmed = await askToConfirm('  Type "approve" to sign this revocation: ');
    if (!confirmed) {
      stdout.write('  Not revoked. Nothing was signed.\n\n');
      exit(1);
    }
    const revoked = await sendSigned(revokeRequest({ modelId, capability, reason }), approverId);
    stdout.write(`\n  accepted — ${JSON.stringify(revoked)}\n\n`);
    return;
  }

  throw new CliRefusal('bad_usage', `Unknown command: ${command}`);
}

const [command, ...rest] = argv.slice(2);
if (!command || command === 'help' || command === '--help') {
  stdout.write(USAGE);
  exit(command ? 0 : 2);
}

try {
  await run(command, parseFlags(rest));
} catch (error) {
  if (error instanceof CliRefusal) {
    // The refusal, never the material. No token, key or MAC has any path here.
    process.stderr.write(`\n  ✗ ${error.code}: ${error.message}\n\n`);
    if (error.code === 'bad_usage') process.stderr.write(USAGE);
    exit(1);
  }
  throw error;
}
