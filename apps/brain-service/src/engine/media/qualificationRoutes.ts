import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { verifyAssertion, type VerifyDeps, type AssertionFailure } from '../internalAuth/assertion.js';
import { ACTION_MODELS_QUALIFY, type InternalAuthConfig } from '../internalAuth/config.js';
import { consumeNonce } from '../persistence/postgres/assertionNonceRepo.js';
import {
  insertEvidenceRun, getEvidenceRun, insertDecision, effectiveApproval,
  approvedForCapability, revokeApproval, decisionHistory, listEvidenceRuns,
  type ModelCapability,
} from '../persistence/postgres/modelQualificationRepo.js';

/**
 * Governed model qualification over HTTP.
 *
 * THERE IS NO UNSIGNED MUTATION PATH. Every route that WRITES — evidence,
 * approval, revocation — goes through `requireAssertion` first. Reads are
 * ordinary internal reads, because reading which model is approved is not a
 * privilege and gating it would only make the router's own lookups awkward.
 *
 * An alternate write path is the failure this design exists to prevent: one
 * "temporary" maintenance route that skips the verifier makes every other
 * control decorative, and it will be the one still there in a year.
 *
 * TWO BOUNDARIES, NEITHER SUFFICIENT ALONE. The operator tool proves the HUMAN
 * holds `platform.models.qualify` against MigraAuth; the signature proves the
 * CALLER is a service permitted to ask. This layer enforces the second and
 * records what the first told it — never treating that claim as proof it was
 * checked.
 */

export interface QualificationRouteDeps {
  internalAuth: InternalAuthConfig;
  /** Runs a function inside a database transaction. */
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  /**
   * AWAITED at every call site. A fire-and-forget append drops its rejection on
   * the floor, and the one record that has no other durable home is the DENIAL —
   * a rejected forgery leaves nothing behind but this.
   */
  audit(event: string, detail: Record<string, unknown>): void | Promise<void>;
  now?: () => number;
}

const CAPABILITIES: readonly ModelCapability[] = [
  // `vision` is the legacy broad name and stays so existing decisions remain
  // readable; new qualifications name the scope they were actually measured for.
  'vision', 'vision.general', 'vision.object_counting',
  'reasoning', 'embedding', 'audio', 'generation', 'chat', 'coding',
];

/**
 * `sha256:` and exactly 64 hex characters.
 *
 * VALIDATED HERE AND NOT ONLY IN THE CALLER. The operator tool checks its own
 * input, but the Brain is what the decision is durable in — and a decision whose
 * digest is a truncated hash, a tag, or an empty string names no particular
 * bytes, which is the one thing an approval exists to do.
 */
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

const isCapability = (v: unknown): v is ModelCapability =>
  typeof v === 'string' && (CAPABILITIES as readonly string[]).includes(v);

/** HTTP status for each way an assertion can fail. */
const STATUS_FOR: Record<AssertionFailure, number> = {
  malformed: 400,
  unsupported_version: 400,
  unknown_key: 401,
  unknown_service: 403,
  action_not_granted: 403,
  wrong_action: 403,
  request_mismatch: 400,
  body_mismatch: 400,
  expired: 401,
  not_yet_valid: 401,
  ttl_too_long: 400,
  bad_mac: 401,
  replayed: 409,
};

export function registerQualificationRoutes(app: FastifyInstance, deps: QualificationRouteDeps): void {
  const now = deps.now ?? (() => Date.now());

  /**
   * Verify the signed assertion on a mutating request.
   *
   * The RAW body is used for the digest, so what was signed is byte-for-byte
   * what arrives — re-serialising a parsed object would compare a
   * reconstruction, and key order or number formatting could differ without
   * anyone touching the request. `installJsonBodyParser` is what preserves those
   * bytes; these routes REFUSE when it has not, rather than assuming it did.
   */
  async function requireAssertion(request: unknown, reply: unknown, path: string, method: string) {
    const req = request as { headers: Record<string, unknown>; body: unknown; rawBody?: string };
    const res = reply as { code: (n: number) => { send: (b: unknown) => unknown } };

    if (!deps.internalAuth.enabled) {
      /*
       * No key configured means privileged mutation is IMPOSSIBLE, not
       * unchecked. A deployment without the secret must be unable to qualify a
       * model, never able to do it without proof.
       */
      await deps.audit('qualification.denied', { reason: 'signing_not_configured', path });
      res.code(503).send({ error: 'signing_not_configured', message: 'Governed qualification is not configured on this deployment.' });
      return null;
    }

    const header = req.headers['x-migrapilot-assertion'];
    let presented: unknown = null;
    try {
      presented = typeof header === 'string' ? JSON.parse(Buffer.from(header, 'base64').toString('utf8')) : null;
    } catch {
      presented = null;
    }

    /*
   * NO FALLBACK. Re-serialising `req.body` here would let the digest check
   * pass over a reconstruction whenever the raw body was not captured — a
   * degradation that looks identical to success. If a route ever escapes the
   * scope that keeps the raw bytes, it refuses instead.
   */
  if (typeof req.rawBody !== 'string') {
    await deps.audit('qualification.denied', { reason: 'raw_body_unavailable', path });
    res.code(400).send({
      error: 'raw_body_unavailable',
      message: 'The signed body could not be compared byte-for-byte.',
    });
    return null;
  }
  const rawBody = req.rawBody;

    const verifyDeps: VerifyDeps = {
      keys: deps.internalAuth.keys,
      servicePolicy: deps.internalAuth.servicePolicy,
      rememberRequestId: async (requestId, expiresAtMs) =>
        deps.transaction((c) => consumeNonce(c, {
          requestId, serviceId: 'pending', action: ACTION_MODELS_QUALIFY,
          expiresAt: expiresAtMs, now: now(),
        })),
    };

    const outcome = await verifyAssertion(
      presented,
      { expectedAction: ACTION_MODELS_QUALIFY, method, path, rawBody, now: now() },
      verifyDeps,
    );

    if (!outcome.ok) {
      /*
       * DIAGNOSTICS ARE AUDIT-SAFE. The reason and the claimed identity are
       * recorded because they are what an investigation needs; the assertion
       * itself, the MAC and any key material never appear — a rejected forgery
       * must not be logged in a form that helps the next attempt.
       */
      const claimed = presented as { serviceId?: unknown; approverId?: unknown; requestId?: unknown } | null;
      await deps.audit('qualification.denied', {
        reason: outcome.reason,
        path,
        claimedService: typeof claimed?.serviceId === 'string' ? claimed.serviceId : null,
        claimedApprover: typeof claimed?.approverId === 'string' ? claimed.approverId : null,
        requestId: typeof claimed?.requestId === 'string' ? claimed.requestId : null,
      });
      res.code(STATUS_FOR[outcome.reason]).send({ error: outcome.reason, message: outcome.detail });
      return null;
    }

    return outcome.assertion;
  }

  // ── reads: ordinary, ungated ────────────────────────────────────────────
  app.get<{ Params: { capability: string } }>('/api/ai/model-qualification/:capability', async (request, reply) => {
    const capability = request.params.capability;
    if (!isCapability(capability)) return reply.code(400).send({ error: 'unknown_capability' });
    const approved = await deps.transaction((c) => approvedForCapability(c, capability));
    return reply.send({ capability, approved });
  });

  /**
   * One evidence run, in full.
   *
   * READ, SO IT IS UNGATED — but it is what makes the approval tool honest: the
   * operator sees the exact digest and result being approved, and the tool
   * re-reads it immediately before signing so a run that changed underneath
   * aborts instead of approving bytes nobody looked at.
   */
  app.get<{ Params: { id: string } }>('/api/ai/model-qualification/evidence/:id', async (request, reply) => {
    const evidence = await deps.transaction((c) => getEvidenceRun(c, request.params.id));
    if (!evidence) return reply.code(404).send({ error: 'unknown_evidence' });
    return reply.send({ evidence });
  });

  app.get<{ Params: { modelId: string; capability: string } }>(
    '/api/ai/model-qualification/:capability/:modelId/evidence',
    async (request, reply) => {
      const { capability, modelId } = request.params;
      if (!isCapability(capability)) return reply.code(400).send({ error: 'unknown_capability' });
      const runs = await deps.transaction((c) => listEvidenceRuns(c, modelId, capability));
      return reply.send({ modelId, capability, runs });
    },
  );

  app.get<{ Params: { modelId: string; capability: string } }>(
    '/api/ai/model-qualification/:capability/:modelId/history',
    async (request, reply) => {
      const { capability, modelId } = request.params;
      if (!isCapability(capability)) return reply.code(400).send({ error: 'unknown_capability' });
      const history = await deps.transaction((c) => decisionHistory(c, modelId, capability));
      return reply.send({ modelId, capability, history });
    },
  );

  // ── mutations: signed only ──────────────────────────────────────────────

  /** Record an immutable evidence run. */
  app.post('/api/ai/model-qualification/evidence', async (request, reply) => {
    const assertion = await requireAssertion(request, reply, '/api/ai/model-qualification/evidence', 'POST');
    if (!assertion) return reply;

    const body = request.body as Record<string, unknown>;
    const capability = body?.capability;
    if (!isCapability(capability) || typeof body?.modelId !== 'string' || typeof body?.suite !== 'string') {
      return reply.code(400).send({ error: 'invalid_request', message: 'modelId, capability and suite are required.' });
    }
    // A malformed digest is refused rather than stored: an evidence run carrying
    // a half-written hash would later be inherited by a decision that then claims
    // to name exact bytes it cannot identify.
    if (body.modelDigest !== undefined && (typeof body.modelDigest !== 'string' || !DIGEST_PATTERN.test(body.modelDigest))) {
      return reply.code(400).send({
        error: 'malformed_digest',
        message: 'modelDigest must be sha256: followed by 64 hex characters.',
      });
    }

    const id = randomUUID();
    await deps.transaction((c) => insertEvidenceRun(c, {
      id,
      modelId: body.modelId as string,
      modelVersion: typeof body.modelVersion === 'string' ? body.modelVersion : undefined,
      modelDigest: typeof body.modelDigest === 'string' ? body.modelDigest : undefined,
      provider: typeof body.provider === 'string' ? body.provider : 'local',
      capability,
      license: typeof body.license === 'string' ? body.license : undefined,
      licenseSource: typeof body.licenseSource === 'string' ? body.licenseSource : undefined,
      suite: body.suite as string,
      results: body.results ?? {},
      environment: body.environment,
      passed: body.passed === true,
      createdAt: now(),
      createdBy: assertion.approverId,
    }));

    await deps.audit('qualification.evidence_recorded', {
      evidenceRunId: id, modelId: body.modelId, capability: body.capability,
      passed: body.passed === true, approver: assertion.approverId,
      service: assertion.serviceId, requestId: assertion.requestId,
    });
    return reply.code(201).send({ evidenceRunId: id });
  });

  /** Approve a model for a capability, pointing at the evidence that justifies it. */
  app.post('/api/ai/model-qualification/approve', async (request, reply) => {
    const assertion = await requireAssertion(request, reply, '/api/ai/model-qualification/approve', 'POST');
    if (!assertion) return reply;

    const body = request.body as Record<string, unknown>;
    const capability = body?.capability;
    if (!isCapability(capability) || typeof body?.modelId !== 'string' || typeof body?.evidenceRunId !== 'string') {
      return reply.code(400).send({ error: 'invalid_request', message: 'modelId, capability and evidenceRunId are required.' });
    }

    try {
      const id = randomUUID();
      const created = await deps.transaction(async (c) => {
        /*
         * THE EVIDENCE MUST EXIST, MATCH, AND HAVE PASSED. An approval pointing
         * at nothing, at another model, or at a failed run is not a governed
         * decision — it is the same hand-wave the JSON file allowed, wearing a
         * foreign key.
         */
        const evidence = await getEvidenceRun(c, body.evidenceRunId as string);
        if (!evidence) return { ok: false as const, error: 'unknown_evidence' };
        if (evidence.modelId !== body.modelId || evidence.capability !== capability) {
          return { ok: false as const, error: 'evidence_mismatch' };
        }
        if (!evidence.passed) return { ok: false as const, error: 'evidence_failed' };
        /*
         * AND IT MUST NAME BYTES. The decision inherits its digest from this row,
         * so evidence recorded without one would produce an approval that
         * authorises a TAG — exactly the thing a digest exists to pin, since a
         * tag can be repointed at different weights afterwards.
         */
        if (!evidence.modelDigest || !DIGEST_PATTERN.test(evidence.modelDigest)) {
          return { ok: false as const, error: 'evidence_without_digest' };
        }

        await insertDecision(c, {
          id,
          modelId: body.modelId as string,
          capability,
          modelVersion: evidence.modelVersion,
          modelDigest: evidence.modelDigest,
          state: 'approved',
          evidenceRunId: evidence.id,
          approverUserId: assertion.approverId,
          callingService: assertion.serviceId,
          requestId: assertion.requestId,
          note: typeof body.note === 'string' ? body.note : undefined,
          decidedAt: now(),
        });
        return { ok: true as const, digest: evidence.modelDigest };
      });

      if (!created.ok) {
        await deps.audit('qualification.denied', { reason: created.error, modelId: body.modelId, approver: assertion.approverId });
        return reply.code(409).send({ error: created.error });
      }

      await deps.audit('qualification.approved', {
        decisionId: id, modelId: body.modelId, capability: body.capability,
        modelDigest: created.digest ?? null, evidenceRunId: body.evidenceRunId,
        approver: assertion.approverId, service: assertion.serviceId, requestId: assertion.requestId,
      });
      return reply.code(201).send({ decisionId: id, state: 'approved' });
    } catch (error) {
      // The live-approval unique index refusing a duplicate is a conflict, not a fault.
      const message = error instanceof Error ? error.message : String(error);
      if (/duplicate key|unique/i.test(message)) {
        return reply.code(409).send({ error: 'already_approved', message: 'That model is already approved for this capability.' });
      }
      throw error;
    }
  });

  /** Revoke a live approval. Takes effect on the next request. */
  app.post('/api/ai/model-qualification/revoke', async (request, reply) => {
    const assertion = await requireAssertion(request, reply, '/api/ai/model-qualification/revoke', 'POST');
    if (!assertion) return reply;

    const body = request.body as Record<string, unknown>;
    const capability = body?.capability;
    if (!isCapability(capability) || typeof body?.modelId !== 'string' || typeof body?.reason !== 'string') {
      return reply.code(400).send({ error: 'invalid_request', message: 'modelId, capability and reason are required.' });
    }

    const revoked = await deps.transaction((c) => revokeApproval(c, {
      modelId: body.modelId as string,
      capability,
      revokedByUserId: assertion.approverId,
      reason: body.reason as string,
      at: now(),
    }));

    if (!revoked) {
      return reply.code(409).send({ error: 'not_approved', message: 'That model is not currently approved for this capability.' });
    }

    await deps.audit('qualification.revoked', {
      modelId: body.modelId, capability: body.capability, reason: body.reason,
      approver: assertion.approverId, service: assertion.serviceId, requestId: assertion.requestId,
    });
    return reply.send({ revoked: true });
  });
}
