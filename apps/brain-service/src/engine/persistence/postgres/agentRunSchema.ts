/**
 * Group 4 — agent run journal schema (PostgreSQL).
 *
 * The four table bodies were DERIVED mechanically from the SQLite DDL in
 * sqliteStore.ts rather than retyped — 105 column definitions is more than can
 * be transcribed safely, and a single wrong column would surface as a runtime
 * failure deep inside the journal. They are maintained here directly from now
 * on; sqliteStore.ts remains the semantic reference.
 *
 * Type mapping preserves SQLite's exact value domain rather than prettifying
 * it: INTEGER to BIGINT (every one of these is epoch-milliseconds or a counter,
 * so there is no timestamp conversion and no timezone question), REAL to DOUBLE
 * PRECISION, BLOB to BYTEA. Booleans stay BIGINT 0/1 for the same reason — the
 * port must not quietly change what a value means.
 *
 * Three things are layered on top of the derived DDL:
 *
 *   1. owner_scope / workspace_scope on every table. Denormalised deliberately:
 *      RLS predicates that need a join are both slower and easier to get wrong.
 *
 *   2. COMPOSITE foreign keys (run_id, owner_scope, workspace_scope) instead of
 *      the plain (run_id) the SQLite schema uses. This is not cosmetic.
 *      PostgreSQL evaluates FK constraint checks internally, with RLS NOT
 *      applied — so a plain FK would happily let a child or event row in
 *      tenant B reference a run owned by tenant A, and RLS would never see it.
 *      The composite FK makes tenant-consistent parentage a structural
 *      guarantee rather than something the writing code has to remember.
 *
 *   3. ins_seq BIGSERIAL as an EXPLICIT insertion-order tie-break. Event order
 *      is (run_id, seq, ins_seq). Relying on PostgreSQL to hand back rows in
 *      insertion order is an assumption, not a guarantee, and it stops being
 *      true the moment a read goes parallel.
 *
 * All nine SQLite indexes are ported, each rewritten scope-leading, because
 * every legitimate read is already scoped and a non-scope-leading index would
 * be unusable under the RLS predicate.
 */

export const M7_AGENT_RUNS = `
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  external_request_ref TEXT,
  activation_ref TEXT NOT NULL,
  workspace_identity TEXT NOT NULL,
  workspace_ref TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  recipe_policy_version TEXT NOT NULL,
  proposal_fingerprint TEXT NOT NULL,
  proposal_hash TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  snapshot_manifest_digest TEXT NOT NULL,
  executable_digest TEXT NOT NULL,
  containment_unit TEXT,
  containment_binding TEXT,
  state TEXT NOT NULL,
  requested_at BIGINT NOT NULL,
  proposal_at BIGINT,
  approval_displayed_at BIGINT,
  approval_decision_at BIGINT,
  execution_started_at BIGINT,
  terminal_at BIGINT,
  expires_at BIGINT NOT NULL,
  timeout_ms BIGINT NOT NULL,
  output_limit_bytes BIGINT NOT NULL,
  mutation_classification TEXT NOT NULL,
  network_policy TEXT NOT NULL,
  expected_effects_json TEXT NOT NULL,
  preview_json TEXT,
  result_json TEXT,
  error_json TEXT,
  exit_code BIGINT,
  signal TEXT,
  failure_code TEXT,
  interruption_classification TEXT,
  approval_lifecycle_version BIGINT NOT NULL DEFAULT 1,
  approval_lifecycle TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  approval_requested_at BIGINT,
  approval_expires_at BIGINT,
  approval_decision_type TEXT,
  approval_invalidation_reason TEXT,
  approval_actor_ref TEXT,
  recovery_class TEXT NOT NULL DEFAULT 'NONE',
  recovery_eligible BIGINT NOT NULL DEFAULT 0,
  recovery_reason TEXT,
  recovery_source_run_id TEXT,
  successor_run_id TEXT,
  reproposal_at BIGINT,
  recovery_attempt_count BIGINT NOT NULL DEFAULT 0,
  last_recovery_request_id TEXT,
  recovery_terminal_reason TEXT,
  audit_seq BIGINT NOT NULL DEFAULT 0,
  schema_version BIGINT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  reconciliation_owner TEXT,
  reconciliation_lease_until BIGINT,
  reconciliation_fence BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  domain_kind TEXT,
  domain_schema_version BIGINT,
  domain_payload_json TEXT,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL,
  -- Target for the composite foreign keys below. Without this, a child row
  -- could reference a run belonging to a different tenant.
  UNIQUE (run_id, owner_scope, workspace_scope)
);

CREATE TABLE IF NOT EXISTS agent_run_children (
  child_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  attempt BIGINT NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  required BIGINT NOT NULL DEFAULT 1,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  started_at BIGINT,
  ended_at BIGINT,
  terminal_category TEXT,
  terminal_evidence_json TEXT,
  cancellation_requested_at BIGINT,
  cancellation_confirmed_at BIGINT,
  error_json TEXT,
  metadata_json TEXT,
  schema_version BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL,
  UNIQUE (run_id, kind, attempt),
  FOREIGN KEY (run_id, owner_scope, workspace_scope)
    REFERENCES agent_runs (run_id, owner_scope, workspace_scope) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_run_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  at BIGINT NOT NULL,
  type TEXT NOT NULL,
  prior_state TEXT,
  next_state TEXT NOT NULL,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  source TEXT NOT NULL,
  schema_version BIGINT NOT NULL,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL,
  UNIQUE (run_id, seq),
  FOREIGN KEY (run_id, owner_scope, workspace_scope)
    REFERENCES agent_runs (run_id, owner_scope, workspace_scope) ON DELETE CASCADE
);

-- Tombstones intentionally carry NO foreign key: the run they describe has
-- been deleted, which is the entire point of the row.
CREATE TABLE IF NOT EXISTS agent_run_tombstones (
  tombstone_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_identity TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  final_state TEXT NOT NULL,
  terminal_at BIGINT NOT NULL,
  deleted_at BIGINT NOT NULL,
  deletion_reason TEXT NOT NULL,
  final_audit_seq BIGINT NOT NULL,
  event_count BIGINT NOT NULL,
  recovery_source_run_id TEXT,
  successor_run_id TEXT,
  schema_version BIGINT NOT NULL,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL
);

-- Ported from the nine SQLite indexes, each rewritten scope-leading.
CREATE INDEX IF NOT EXISTS idx_agent_runs_state
  ON agent_runs (owner_scope, workspace_scope, state, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace
  ON agent_runs (owner_scope, workspace_scope, workspace_identity, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_terminal
  ON agent_runs (owner_scope, workspace_scope, terminal_at, state);
CREATE INDEX IF NOT EXISTS idx_agent_runs_nonterminal
  ON agent_runs (owner_scope, workspace_scope, state, reconciliation_lease_until, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_reconciliation
  ON agent_runs (owner_scope, workspace_scope, reconciliation_owner, reconciliation_fence, version, reconciliation_lease_until);
CREATE INDEX IF NOT EXISTS idx_agent_runs_recovery_source
  ON agent_runs (owner_scope, workspace_scope, recovery_source_run_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_children_run
  ON agent_run_children (owner_scope, workspace_scope, run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_children_active
  ON agent_run_children (owner_scope, workspace_scope, run_id, state, required);
-- Event replay order is (run_id, seq, ins_seq) — ins_seq is the explicit
-- insertion tie-break, never left to PostgreSQL's row ordering.
CREATE INDEX IF NOT EXISTS idx_agent_run_events_run
  ON agent_run_events (owner_scope, workspace_scope, run_id, seq, ins_seq);
CREATE INDEX IF NOT EXISTS idx_agent_run_tombstones_deleted
  ON agent_run_tombstones (owner_scope, workspace_scope, deleted_at);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_runs_scope ON agent_runs;
CREATE POLICY agent_runs_scope ON agent_runs
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_runs TO migrapilot_app;

ALTER TABLE agent_run_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_children FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_children_scope ON agent_run_children;
CREATE POLICY agent_run_children_scope ON agent_run_children
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_run_children TO migrapilot_app;

ALTER TABLE agent_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_events_scope ON agent_run_events;
CREATE POLICY agent_run_events_scope ON agent_run_events
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_run_events TO migrapilot_app;

ALTER TABLE agent_run_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_tombstones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_tombstones_scope ON agent_run_tombstones;
CREATE POLICY agent_run_tombstones_scope ON agent_run_tombstones
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_run_tombstones TO migrapilot_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO migrapilot_app;
`;
