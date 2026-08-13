/**
 * Group 5 — operational metadata schema (PostgreSQL).
 *
 * Audit events, usage records, incidents, recovery events, budget scopes and
 * reservations. Column names, nullability and value domains are the SQLite
 * ones exactly: these tables are deliberately loose (almost every column is
 * nullable) and the port does not tighten them, because tightening would
 * reject rows SQLite accepts and that is a behaviour change, not an
 * improvement.
 *
 * Type mapping as elsewhere: INTEGER to BIGINT (epoch-ms and counters), REAL to
 * DOUBLE PRECISION (money columns keep their existing float domain rather than
 * being silently promoted to NUMERIC — changing the arithmetic during a port is
 * how rounding bugs get introduced).
 *
 * ─── Structural tenant parentage ────────────────────────────────────────────
 *
 * Group 4 established that RLS cannot be the only defence for a cross-row
 * reference, because PostgreSQL evaluates foreign key constraints internally
 * with RLS NOT applied. The same reasoning is applied here.
 *
 * op_recovery_events.incident_id is the one operational reference that points
 * at another scoped row, so it carries a COMPOSITE foreign key
 * (incident_id, owner_scope, workspace_scope) -> op_incidents. A recovery event
 * therefore cannot be filed against another tenant's incident.
 *
 * Two details make that FK work rather than break retention:
 *
 *   • MATCH SIMPLE (the default) skips the check entirely when incident_id IS
 *     NULL, which is the common case — most recovery events have no incident.
 *
 *   • ON DELETE SET NULL (incident_id) names the column explicitly. A bare
 *     SET NULL would try to null owner_scope and workspace_scope too, which are
 *     NOT NULL, and every incident prune would fail. Nulling only the reference
 *     preserves SQLite's outcome — pruning an incident leaves its recovery
 *     events in place — while turning a dangling id into an honest NULL rather
 *     than a lie. Column lists on SET NULL require PostgreSQL 15+, asserted
 *     below so the requirement fails loudly instead of as a syntax error.
 *
 * op_reservations.scope_ids_json references op_budget_scopes, but as a JSON
 * ARRAY of scope ids. That cannot take a foreign key without restructuring the
 * storage contract into a junction table, which is a redesign and out of scope
 * for a port. It is left as-is deliberately: both tables are RLS-confined, and
 * loadBudgetScopes only ever returns the caller's own scopes, so an alien
 * scope id in that array resolves to nothing rather than leaking anything. The
 * residual risk is a dangling reference, not a cross-tenant read.
 */

export const M8_OPERATIONAL = `
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION
      'MigraPilot requires PostgreSQL 15 or newer (found %). Migration 8 uses a column list on ON DELETE SET NULL.',
      current_setting('server_version');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS op_audit_events (
  event_id TEXT PRIMARY KEY,
  correlation_id TEXT,
  causation_id TEXT,
  seq BIGINT,
  type TEXT,
  at BIGINT,
  duration_ms BIGINT,
  component TEXT,
  outcome TEXT,
  request_id TEXT,
  fields_json TEXT,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL
);

CREATE TABLE IF NOT EXISTS op_usage_records (
  usage_id TEXT PRIMARY KEY,
  correlation_id TEXT,
  provider_id TEXT,
  model_id TEXT,
  execution_mode TEXT,
  policy TEXT,
  local_or_cloud TEXT,
  at BIGINT,
  outcome TEXT,
  cost_usd DOUBLE PRECISION,
  cost_status TEXT,
  escalation_reason TEXT,
  fields_json TEXT,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL
);

CREATE TABLE IF NOT EXISTS op_incidents (
  incident_id TEXT PRIMARY KEY,
  dedup_key TEXT,
  correlation_id TEXT,
  first_seen_at BIGINT,
  last_seen_at BIGINT,
  occurrence_count BIGINT,
  state TEXT,
  severity TEXT,
  affected_json TEXT,
  last_delivery_status TEXT,
  resolution_json TEXT,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL,
  -- Target for the composite foreign key on op_recovery_events.
  UNIQUE (incident_id, owner_scope, workspace_scope)
);

CREATE TABLE IF NOT EXISTS op_recovery_events (
  id TEXT PRIMARY KEY,
  recovery_id TEXT,
  correlation_id TEXT,
  incident_id TEXT,
  type TEXT,
  at BIGINT,
  outcome TEXT,
  fields_json TEXT,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL,
  FOREIGN KEY (incident_id, owner_scope, workspace_scope)
    REFERENCES op_incidents (incident_id, owner_scope, workspace_scope)
    ON DELETE SET NULL (incident_id)
);

CREATE TABLE IF NOT EXISTS op_budget_scopes (
  scope_id TEXT PRIMARY KEY,
  kind TEXT,
  scope_key TEXT,
  hard_limit_usd DOUBLE PRECISION,
  spent_usd DOUBLE PRECISION,
  reserved_usd DOUBLE PRECISION,
  period_start BIGINT,
  updated_at BIGINT,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL
);

CREATE TABLE IF NOT EXISTS op_reservations (
  reservation_id TEXT PRIMARY KEY,
  amount_usd DOUBLE PRECISION,
  scope_ids_json TEXT,
  correlation_id TEXT,
  provider_id TEXT,
  model_id TEXT,
  created_at BIGINT,
  expires_at BIGINT,
  status TEXT,
  owner_scope migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  ins_seq BIGSERIAL
);

-- Ported from the SQLite indexes, each rewritten scope-leading.
CREATE INDEX IF NOT EXISTS idx_op_audit_corr
  ON op_audit_events (owner_scope, workspace_scope, correlation_id, seq);
CREATE INDEX IF NOT EXISTS idx_op_audit_at
  ON op_audit_events (owner_scope, workspace_scope, at);
CREATE INDEX IF NOT EXISTS idx_op_usage_at
  ON op_usage_records (owner_scope, workspace_scope, at);
CREATE INDEX IF NOT EXISTS idx_op_usage_lc
  ON op_usage_records (owner_scope, workspace_scope, local_or_cloud, at);
CREATE INDEX IF NOT EXISTS idx_op_incident_seen
  ON op_incidents (owner_scope, workspace_scope, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_op_recovery_at
  ON op_recovery_events (owner_scope, workspace_scope, at);

ALTER TABLE op_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS op_audit_events_scope ON op_audit_events;
CREATE POLICY op_audit_events_scope ON op_audit_events
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON op_audit_events TO migrapilot_app;

ALTER TABLE op_usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_usage_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS op_usage_records_scope ON op_usage_records;
CREATE POLICY op_usage_records_scope ON op_usage_records
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON op_usage_records TO migrapilot_app;

ALTER TABLE op_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS op_incidents_scope ON op_incidents;
CREATE POLICY op_incidents_scope ON op_incidents
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON op_incidents TO migrapilot_app;

ALTER TABLE op_recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_recovery_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS op_recovery_events_scope ON op_recovery_events;
CREATE POLICY op_recovery_events_scope ON op_recovery_events
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON op_recovery_events TO migrapilot_app;

ALTER TABLE op_budget_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_budget_scopes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS op_budget_scopes_scope ON op_budget_scopes;
CREATE POLICY op_budget_scopes_scope ON op_budget_scopes
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON op_budget_scopes TO migrapilot_app;

ALTER TABLE op_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_reservations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS op_reservations_scope ON op_reservations;
CREATE POLICY op_reservations_scope ON op_reservations
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
GRANT SELECT, INSERT, UPDATE, DELETE ON op_reservations TO migrapilot_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO migrapilot_app;
`;
