import type { PoolClient } from 'pg';

/**
 * Governed model qualification: evidence, decisions, and what may serve now.
 *
 * EVIDENCE IS IMMUTABLE AND DECISIONS ARE APPEND-ONLY. There is deliberately no
 * update path for either: an evidence run is a measurement that happened, and a
 * decision is a judgement that was made. Editing one rewrites history, and the
 * whole reason this replaced a hand-edited JSON file is that a file cannot say
 * who decided what, when, or on what basis.
 *
 * REVOCATION IS A WRITE, NOT A DELETE. `revoked_at` is stamped and the row stays,
 * so "what was approved on the day it happened" remains answerable.
 *
 * EFFECTIVE APPROVAL IS DERIVED PER CALL, never cached. A cached answer outlives
 * the revocation that should have ended it, and the moment you revoke a model is
 * precisely when a stale cache does the most damage.
 */

export type ModelCapability = 'vision' | 'reasoning' | 'embedding' | 'audio' | 'generation' | 'chat' | 'coding';
export type DecisionState = 'candidate' | 'approved' | 'revoked';

export interface EvidenceRun {
  id: string;
  modelId: string;
  modelVersion?: string | undefined;
  modelDigest?: string | undefined;
  provider: string;
  capability: ModelCapability;
  license?: string | undefined;
  licenseSource?: string | undefined;
  suite: string;
  results: unknown;
  environment?: unknown;
  passed: boolean;
  createdAt: number;
  createdBy?: string | undefined;
}

export interface QualificationDecision {
  id: string;
  modelId: string;
  capability: ModelCapability;
  modelVersion?: string | undefined;
  modelDigest?: string | undefined;
  state: DecisionState;
  evidenceRunId?: string | undefined;
  /** The human MigraAuth authorized. */
  approverUserId?: string | undefined;
  /** The service that carried the signed request, and that request's id. */
  callingService?: string | undefined;
  requestId?: string | undefined;
  note?: string | undefined;
  decidedAt: number;
  revokedAt?: number | undefined;
  revokedByUserId?: string | undefined;
  revokedReason?: string | undefined;
}

const num = (v: unknown): number => (typeof v === 'string' ? Number(v) : (v as number));

export async function insertEvidenceRun(client: PoolClient, run: EvidenceRun): Promise<void> {
  await client.query(
    `INSERT INTO model_evidence_runs
       (id, model_id, model_version, model_digest, provider, capability, license, license_source,
        suite, results_json, environment_json, passed, created_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      run.id, run.modelId, run.modelVersion ?? null, run.modelDigest ?? null, run.provider,
      run.capability, run.license ?? null, run.licenseSource ?? null, run.suite,
      JSON.stringify(run.results), run.environment === undefined ? null : JSON.stringify(run.environment),
      run.passed, run.createdAt, run.createdBy ?? null,
    ],
  );
}

export async function getEvidenceRun(client: PoolClient, id: string): Promise<EvidenceRun | null> {
  const { rows } = await client.query(`SELECT * FROM model_evidence_runs WHERE id = $1`, [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, modelId: r.model_id, modelVersion: r.model_version ?? undefined,
    modelDigest: r.model_digest ?? undefined, provider: r.provider, capability: r.capability,
    license: r.license ?? undefined, licenseSource: r.license_source ?? undefined,
    suite: r.suite, results: r.results_json, environment: r.environment_json ?? undefined,
    passed: r.passed, createdAt: num(r.created_at), createdBy: r.created_by ?? undefined,
  };
}

export async function insertDecision(client: PoolClient, decision: QualificationDecision): Promise<void> {
  await client.query(
    `INSERT INTO model_qualification_decisions
       (id, model_id, capability, model_version, model_digest, state, evidence_run_id,
        approver_user_id, calling_service, request_id, note, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      decision.id, decision.modelId, decision.capability, decision.modelVersion ?? null,
      decision.modelDigest ?? null, decision.state, decision.evidenceRunId ?? null,
      decision.approverUserId ?? null, decision.callingService ?? null, decision.requestId ?? null,
      decision.note ?? null, decision.decidedAt,
    ],
  );
}

/**
 * The live approval for a capability+model, if any.
 *
 * MATCHED ON EXACT IDENTITY. A decision approving one digest must not authorize
 * a different set of bytes wearing the same tag — which is precisely what a tag
 * can be repointed to do.
 */
export async function effectiveApproval(
  client: PoolClient,
  modelId: string,
  capability: ModelCapability,
  digest?: string,
): Promise<QualificationDecision | null> {
  const { rows } = await client.query(
    `SELECT * FROM model_qualification_decisions
      WHERE model_id = $1 AND capability = $2 AND state = 'approved' AND revoked_at IS NULL
        AND ($3::text IS NULL OR model_digest IS NULL OR model_digest = $3)
      ORDER BY decided_at DESC
      LIMIT 1`,
    [modelId, capability, digest ?? null],
  );
  return rows[0] ? hydrate(rows[0]) : null;
}

/** Everything currently approved for a capability — the router's eligibility set. */
export async function approvedForCapability(
  client: PoolClient,
  capability: ModelCapability,
): Promise<QualificationDecision[]> {
  const { rows } = await client.query(
    `SELECT * FROM model_qualification_decisions
      WHERE capability = $1 AND state = 'approved' AND revoked_at IS NULL
      ORDER BY decided_at DESC`,
    [capability],
  );
  return rows.map(hydrate);
}

/**
 * Revoke the live approval.
 *
 * CONDITIONAL on it still being live, and the row count is the answer: two
 * concurrent revocations must not both report success, and an `UPDATE` that
 * matched nothing is not a revocation that happened.
 */
export async function revokeApproval(
  client: PoolClient,
  input: { modelId: string; capability: ModelCapability; revokedByUserId: string; reason: string; at: number },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE model_qualification_decisions
        SET revoked_at = $1, revoked_by_user_id = $2, revoked_reason = $3
      WHERE model_id = $4 AND capability = $5 AND state = 'approved' AND revoked_at IS NULL`,
    [input.at, input.revokedByUserId, input.reason, input.modelId, input.capability],
  );
  return (rowCount ?? 0) > 0;
}

/** Every decision ever made for a model+capability, newest first. History is kept. */
export async function decisionHistory(
  client: PoolClient,
  modelId: string,
  capability: ModelCapability,
): Promise<QualificationDecision[]> {
  const { rows } = await client.query(
    `SELECT * FROM model_qualification_decisions
      WHERE model_id = $1 AND capability = $2
      ORDER BY decided_at DESC`,
    [modelId, capability],
  );
  return rows.map(hydrate);
}

function hydrate(r: Record<string, unknown>): QualificationDecision {
  return {
    id: r.id as string,
    modelId: r.model_id as string,
    capability: r.capability as ModelCapability,
    modelVersion: (r.model_version as string) ?? undefined,
    modelDigest: (r.model_digest as string) ?? undefined,
    state: r.state as DecisionState,
    evidenceRunId: (r.evidence_run_id as string) ?? undefined,
    approverUserId: (r.approver_user_id as string) ?? undefined,
    callingService: (r.calling_service as string) ?? undefined,
    requestId: (r.request_id as string) ?? undefined,
    note: (r.note as string) ?? undefined,
    decidedAt: num(r.decided_at),
    revokedAt: r.revoked_at === null || r.revoked_at === undefined ? undefined : num(r.revoked_at),
    revokedByUserId: (r.revoked_by_user_id as string) ?? undefined,
    revokedReason: (r.revoked_reason as string) ?? undefined,
  };
}
