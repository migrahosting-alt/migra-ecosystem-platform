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
import { argv, env, exit, stdout } from 'node:process';

import {
  CliRefusal, approverFrom, approveRequest, revokeRequest, evidenceRequest,
  evidenceUnchanged, signMutation, confirmationText, askToConfirm, selectKey, readToken,
  requireExplicitOutcome,
  type AdminMeResponse, type EvidenceView, type MutationRequest,
} from './qualifyModel.js';

const AUTH_BASE = (env.MIGRAAUTH_API_URL ?? 'https://auth.migrateck.com').replace(/\/+$/, '');
const BRAIN_BASE = (env.MIGRAPILOT_BRAIN_URL ?? `http://127.0.0.1:${env.MIGRAPILOT_BRAIN_PORT ?? 3988}`).replace(/\/+$/, '');

const USAGE = `
  migrapilot-qualify — governed model qualification

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
async function sendSigned(request: MutationRequest, approverId: string): Promise<void> {
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
  stdout.write(`\n  accepted — request ${signed.requestId}\n  ${JSON.stringify(body)}\n\n`);
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
    await sendSigned(request, approverId);
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

    await sendSigned(
      approveRequest({ modelId, capability, evidenceRunId, note: optional(flags, 'note') }),
      approverId,
    );
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
    await sendSigned(revokeRequest({ modelId, capability, reason }), approverId);
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
