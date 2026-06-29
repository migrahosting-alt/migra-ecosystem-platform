// MigraPilot — Postgres ops action journal (Phase 11.2). DORMANT by default.
// Enabled only when PILOT_OPS_ACTION_JOURNAL=postgres AND DATABASE_URL are set. The `pg` package is
// imported LAZILY via a non-literal specifier so dev/build never require it. If pg is missing / the
// DB is unreachable / the table is absent, init() throws and the dispatcher falls back to in-memory
// (unless PILOT_OPS_ACTION_JOURNAL_FAIL_CLOSED is set).
//
// Schema: see migrations/0003_pilot_ops_action_journal.sql. Verified Phase 12.1 against dev PostgreSQL 16.
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ActionJournal, ActionRecord } from "./ops-action-journal";

let pool: any = null;
let ready = false;

async function getPool(): Promise<any> {
  if (pool) return pool;
  const spec = "pg"; // non-literal specifier: not resolved at type-check/bundle time
  let pg: any;
  try {
    pg = await import(spec);
  } catch {
    throw new Error("the 'pg' package is not installed (enable the persistent journal with: npm install pg)");
  }
  const Pool = pg.Pool ?? pg.default?.Pool;
  if (!Pool) throw new Error("invalid 'pg' module: no Pool export");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // connectionTimeoutMillis keeps fallback fast/safe even if DATABASE_URL points at an unreachable host.
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 4000 });
  return pool;
}

function rowToRec(r: any): ActionRecord {
  return {
    id: r.id,
    actionName: r.action_name,
    category: r.category,
    executionMode: r.execution_mode,
    target: r.target,
    reason: r.reason ?? "",
    mutated: !!r.mutated,
    dryRun: !!r.dry_run,
    executed: !!r.executed,
    status: r.status,
    approvalId: r.approval_id ?? undefined,
    runId: r.run_id ?? undefined,
    metadata: r.metadata ?? undefined,
    summary: r.summary ?? undefined,
    verificationSummary: r.verification_summary ?? undefined,
    createdAt: typeof r.created_at === "string" ? r.created_at : r.created_at?.toISOString(),
    updatedAt: r.updated_at ? (typeof r.updated_at === "string" ? r.updated_at : r.updated_at.toISOString()) : undefined as unknown as string,
  };
}

export const pgActionJournal: ActionJournal & { init(): Promise<void> } = {
  async init() {
    if (ready) return;
    const p = await getPool();
    await p.query("SELECT 1 FROM pilot_ops_action_journal LIMIT 1"); // throws if migration not applied
    ready = true;
  },

  async create(rec) {
    const p = await getPool();
    await p.query(
      `INSERT INTO pilot_ops_action_journal
        (id, action_name, category, execution_mode, target, reason, mutated, dry_run, executed, status, approval_id, run_id, metadata, summary, verification_summary, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO NOTHING`,
      [rec.id, rec.actionName, rec.category, rec.executionMode, rec.target, rec.reason ?? null, rec.mutated, rec.dryRun, rec.executed, rec.status, rec.approvalId ?? null, rec.runId ?? null, rec.metadata ? JSON.stringify(rec.metadata) : null, rec.summary ?? null, rec.verificationSummary ?? null, rec.createdAt, rec.updatedAt],
    );
    return rec;
  },

  async get(id) {
    const p = await getPool();
    const { rows } = await p.query("SELECT * FROM pilot_ops_action_journal WHERE id=$1", [id]);
    return rows[0] ? rowToRec(rows[0]) : undefined;
  },

  async listRecent(limit) {
    const p = await getPool();
    const { rows } = await p.query("SELECT * FROM pilot_ops_action_journal ORDER BY created_at DESC LIMIT $1", [Math.max(0, Math.min(limit, 200))]);
    return rows.map(rowToRec);
  },

  async markVerified(id, summary) {
    const p = await getPool();
    const { rows } = await p.query("UPDATE pilot_ops_action_journal SET status='verified', verification_summary=$2, updated_at=now() WHERE id=$1 RETURNING *", [id, summary]);
    return rows[0] ? rowToRec(rows[0]) : undefined;
  },
};
