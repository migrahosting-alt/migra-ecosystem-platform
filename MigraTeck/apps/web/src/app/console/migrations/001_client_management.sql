-- ─────────────────────────────────────────────────────────────────────────────
--  Console — client account management (audit log, notes, contacts)
--  Idempotent: safe to run multiple times.
--
--  Apply on db-core via Tailscale (run on app-core where the env var is set):
--    psql "$MIGRAPANEL_DB_URL" -f 001_client_management.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Migration tracking. Every migration records itself here on success so we can
-- see what's been applied via SELECT * FROM _console_migrations_applied.
CREATE TABLE IF NOT EXISTS _console_migrations_applied (
  name        TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ DEFAULT NOW(),
  notes       TEXT
);

-- Audit log of every console-driven mutation on a tenant.
-- Powers the activity timeline + answers "who changed what, when, why".
CREATE TABLE IF NOT EXISTS client_events (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  actor_id      TEXT,            -- console user id (admin@migrateck.com etc)
  actor_email   TEXT,            -- denormalized for display
  action        TEXT NOT NULL,   -- e.g. tenant.suspend, subscription.cancel, addon.add
  resource      TEXT,            -- subscription / order / addon / tenant
  resource_id   TEXT,
  reason        TEXT,            -- human-entered explanation
  metadata      JSONB DEFAULT '{}'::jsonb,
  result        TEXT DEFAULT 'success', -- success | failure
  error         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_events_tenant_created
  ON client_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_events_action
  ON client_events (action);

-- Internal ops notes per tenant (not visible to client).
CREATE TABLE IF NOT EXISTS client_notes (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  author_id   TEXT,
  author_email TEXT,
  body        TEXT NOT NULL,
  pinned      BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_client_notes_tenant
  ON client_notes (tenant_id, pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;

-- Multiple contacts per tenant: billing, technical, primary user, etc.
CREATE TABLE IF NOT EXISTS client_contacts (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'primary', -- primary | billing | technical | escalation
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  title       TEXT,
  notes       TEXT,
  is_default  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_tenant
  ON client_contacts (tenant_id, role)
  WHERE deleted_at IS NULL;

-- Optional column additions that other code already writes to.
-- Each is wrapped in EXCEPTION-swallowing DO so the migration succeeds even if
-- the parent table is missing or has different ownership.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'subscriptions' AND column_name = 'display_name'
  ) THEN
    ALTER TABLE subscriptions ADD COLUMN display_name TEXT;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'orders' AND column_name = 'payment_link_url'
  ) THEN
    ALTER TABLE orders ADD COLUMN payment_link_url TEXT;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'orders' AND column_name = 'payment_link_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN payment_link_id TEXT;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Some Postgres `orders` schemas don't include tax_rate / tax_amount even
-- though the typical billing table does. Add them defensively.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'orders' AND column_name = 'tax_rate'
  ) THEN
    ALTER TABLE orders ADD COLUMN tax_rate NUMERIC(6,4) DEFAULT 0;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'orders' AND column_name = 'tax_amount'
  ) THEN
    ALTER TABLE orders ADD COLUMN tax_amount NUMERIC(12,2) DEFAULT 0;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

INSERT INTO _console_migrations_applied (name, notes)
  VALUES ('001_client_management', 'audit log, notes, contacts, subscriptions.display_name, orders.payment_link_*, orders.tax_*')
  ON CONFLICT (name) DO NOTHING;
