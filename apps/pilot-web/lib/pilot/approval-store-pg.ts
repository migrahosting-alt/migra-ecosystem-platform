// MigraPilot — Postgres approval store (Phase 9.9). DORMANT by default.
// Enabled only when PILOT_APPROVAL_STORE=postgres AND DATABASE_URL are set. The `pg`
// package is imported LAZILY via a non-literal specifier so dev/build never require it.
// If pg is missing / the DB is unreachable / the table is absent, init() throws and the
// dispatcher falls back to in-memory (unless PILOT_APPROVAL_FAIL_CLOSED is set).
//
// Schema: see migrations/0002_pilot_approvals.sql. Verified Phase 10.0 against dev PostgreSQL 16.
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ApprovalRequest } from "./types";
import type { ApprovalStore } from "./approval-store";

let pool: any = null;
let ready = false;

async function getPool(): Promise<any> {
  if (pool) return pool;
  const spec = "pg"; // non-literal specifier: not resolved at type-check/bundle time
  let pg: any;
  try {
    pg = await import(spec);
  } catch {
    throw new Error("the 'pg' package is not installed (enable persistent approvals with: npm install pg)");
  }
  const Pool = pg.Pool ?? pg.default?.Pool;
  if (!Pool) throw new Error("invalid 'pg' module: no Pool export");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

function rowToRec(r: any): ApprovalRequest {
  return {
    id: r.id,
    runId: r.run_id,
    stepId: r.step_id ?? undefined,
    toolName: r.tool_name,
    args: r.args ?? {},
    argsDigest: r.args_digest ?? undefined,
    risk: r.risk,
    reason: r.reason ?? undefined,
    summary: r.summary ?? undefined,
    expectedEffect: r.expected_effect ?? undefined,
    status: r.status,
    createdAt: typeof r.created_at === "string" ? r.created_at : r.created_at?.toISOString(),
    updatedAt: r.updated_at ? (typeof r.updated_at === "string" ? r.updated_at : r.updated_at.toISOString()) : undefined,
    expiresAt: r.expires_at ? (typeof r.expires_at === "string" ? r.expires_at : r.expires_at.toISOString()) : undefined,
    executedAt: r.executed_at ? (typeof r.executed_at === "string" ? r.executed_at : r.executed_at.toISOString()) : undefined,
    detail: r.detail ?? undefined,
  };
}

async function expireStale(p: any, approvalId: string): Promise<void> {
  await p.query("UPDATE pilot_approvals SET status='expired', updated_at=now() WHERE id=$1 AND status='pending' AND expires_at IS NOT NULL AND expires_at < now()", [approvalId]);
}

export const pgApprovalStore: ApprovalStore & { init(): Promise<void> } = {
  async init() {
    if (ready) return;
    const p = await getPool();
    await p.query("SELECT 1 FROM pilot_approvals LIMIT 1"); // throws if migration not applied
    ready = true;
  },

  async create(rec) {
    const p = await getPool();
    await p.query(
      `INSERT INTO pilot_approvals
        (id, run_id, step_id, tool_name, args, args_digest, risk, reason, summary, expected_effect, status, created_at, updated_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO NOTHING`,
      [rec.id, rec.runId, rec.stepId ?? null, rec.toolName, JSON.stringify(rec.args ?? {}), rec.argsDigest ?? null, rec.risk, rec.reason ?? null, rec.summary ?? null, rec.expectedEffect ?? null, rec.status, rec.createdAt, rec.updatedAt ?? rec.createdAt, rec.expiresAt ?? null],
    );
    return rec;
  },

  async get(approvalId) {
    const p = await getPool();
    await expireStale(p, approvalId);
    const { rows } = await p.query("SELECT * FROM pilot_approvals WHERE id=$1", [approvalId]);
    return rows[0] ? rowToRec(rows[0]) : undefined;
  },

  // Atomic exact-once claim: only one caller can move pending → approved.
  async claim(approvalId) {
    const p = await getPool();
    await expireStale(p, approvalId);
    const { rows } = await p.query(
      "UPDATE pilot_approvals SET status='approved', updated_at=now() WHERE id=$1 AND status='pending' AND (expires_at IS NULL OR expires_at > now()) RETURNING *",
      [approvalId],
    );
    return rows[0] ? rowToRec(rows[0]) : null;
  },

  async cancel(approvalId) {
    const p = await getPool();
    const { rows } = await p.query(
      "UPDATE pilot_approvals SET status='cancelled', updated_at=now() WHERE id=$1 AND status='pending' RETURNING *",
      [approvalId],
    );
    return rows[0] ? rowToRec(rows[0]) : null;
  },

  async markExecuted(approvalId, detail) {
    const p = await getPool();
    await p.query("UPDATE pilot_approvals SET status='executed', executed_at=now(), updated_at=now(), detail=$2 WHERE id=$1", [approvalId, detail]);
  },

  async markBlocked(approvalId, detail) {
    const p = await getPool();
    await p.query("UPDATE pilot_approvals SET status='blocked', updated_at=now(), detail=$2 WHERE id=$1", [approvalId, detail]);
  },

  async listRecent(limit) {
    const p = await getPool();
    const { rows } = await p.query("SELECT * FROM pilot_approvals ORDER BY created_at DESC LIMIT $1", [Math.max(0, limit)]);
    return rows.map(rowToRec);
  },
};
