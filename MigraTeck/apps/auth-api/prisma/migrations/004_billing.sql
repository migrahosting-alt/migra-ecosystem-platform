-- 004_billing.sql
-- MigraTeck Billing — Platform billing tables
-- PostgreSQL 16+ · database: auth_migrateck
-- Adds the full billing control-plane schema to the auth database.
-- Run: psql $AUTH_DATABASE_URL -f ./prisma/migrations/004_billing.sql
-- ─────────────────────────────────────────────────────────────────────

-- ── Enum Types ──────────────────────────────────────────────────────

CREATE TYPE billing_account_status AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE subscription_status AS ENUM (
  'active', 'trialing', 'past_due', 'paused', 'canceled',
  'incomplete', 'incomplete_expired', 'unpaid'
);
CREATE TYPE billing_component_type AS ENUM ('base', 'seat', 'usage', 'onboarding');
CREATE TYPE billing_interval AS ENUM ('month', 'year');
CREATE TYPE invoice_status AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');
CREATE TYPE quote_status AS ENUM ('draft', 'open', 'accepted', 'canceled');
CREATE TYPE dunning_state AS ENUM (
  'active', 'past_due', 'grace_period', 'restricted', 'suspended', 'canceled'
);
CREATE TYPE webhook_event_status AS ENUM ('pending', 'processed', 'failed', 'skipped');
CREATE TYPE adjustment_kind AS ENUM (
  'credit', 'service_credit', 'goodwill', 'refund', 'promo'
);
CREATE TYPE usage_source AS ENUM ('api', 'worker', 'system', 'manual');
CREATE TYPE entitlement_source_type AS ENUM (
  'subscription', 'trial', 'manual_override', 'promotional'
);

-- ── billing_accounts ────────────────────────────────────────────────

CREATE TABLE billing_accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL UNIQUE,
  stripe_customer_id   VARCHAR(255) UNIQUE,
  default_currency     VARCHAR(3) NOT NULL DEFAULT 'usd',
  billing_email        VARCHAR(255),
  billing_contact_name VARCHAR(255),
  tax_country          VARCHAR(2),
  tax_state            VARCHAR(80),
  tax_id               VARCHAR(80),
  status               billing_account_status NOT NULL DEFAULT 'active',
  dunning_state        dunning_state NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── billing_subscriptions ───────────────────────────────────────────

CREATE TABLE billing_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL,
  billing_account_id      UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  stripe_subscription_id  VARCHAR(255) UNIQUE,
  product_family          VARCHAR(40) NOT NULL,
  plan_code               VARCHAR(40) NOT NULL,
  status                  subscription_status NOT NULL DEFAULT 'incomplete',
  billing_interval        billing_interval NOT NULL DEFAULT 'month',
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
  trial_ends_at           TIMESTAMPTZ,
  paused_at               TIMESTAMPTZ,
  canceled_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_subscriptions_org_family ON billing_subscriptions (org_id, product_family);
CREATE INDEX idx_billing_subscriptions_stripe_id ON billing_subscriptions (stripe_subscription_id);

-- ── billing_subscription_items ──────────────────────────────────────

CREATE TABLE billing_subscription_items (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_subscription_id    UUID NOT NULL REFERENCES billing_subscriptions(id) ON DELETE CASCADE,
  stripe_subscription_item_id VARCHAR(255) UNIQUE,
  component_type             billing_component_type NOT NULL,
  price_lookup_key           VARCHAR(120),
  quantity                   INTEGER,
  meter_name                 VARCHAR(80),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── billing_invoices ────────────────────────────────────────────────

CREATE TABLE billing_invoices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL,
  billing_account_id      UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  stripe_invoice_id       VARCHAR(255) UNIQUE,
  stripe_subscription_id  VARCHAR(255),
  status                  invoice_status NOT NULL DEFAULT 'draft',
  currency                VARCHAR(3) NOT NULL DEFAULT 'usd',
  subtotal                INTEGER NOT NULL DEFAULT 0,
  tax                     INTEGER NOT NULL DEFAULT 0,
  total                   INTEGER NOT NULL DEFAULT 0,
  amount_paid             INTEGER NOT NULL DEFAULT 0,
  amount_remaining        INTEGER NOT NULL DEFAULT 0,
  hosted_invoice_url      TEXT,
  invoice_pdf             TEXT,
  period_start            TIMESTAMPTZ,
  period_end              TIMESTAMPTZ,
  issued_at               TIMESTAMPTZ,
  paid_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_invoices_org ON billing_invoices (org_id);
CREATE INDEX idx_billing_invoices_stripe ON billing_invoices (stripe_invoice_id);

-- ── billing_payment_methods ─────────────────────────────────────────

CREATE TABLE billing_payment_methods (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   UUID NOT NULL,
  billing_account_id       UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  stripe_payment_method_id VARCHAR(255) NOT NULL UNIQUE,
  type                     VARCHAR(40) NOT NULL,
  brand                    VARCHAR(40),
  last4                    VARCHAR(4),
  exp_month                INTEGER,
  exp_year                 INTEGER,
  is_default               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_payment_methods_org ON billing_payment_methods (org_id);

-- ── billing_usage_events ────────────────────────────────────────────

CREATE TABLE billing_usage_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL,
  billing_account_id      UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  product_family          VARCHAR(40) NOT NULL,
  meter_name              VARCHAR(80) NOT NULL,
  quantity                INTEGER NOT NULL,
  window_start            TIMESTAMPTZ NOT NULL,
  window_end              TIMESTAMPTZ NOT NULL,
  idempotency_key         VARCHAR(255) NOT NULL UNIQUE,
  source                  usage_source NOT NULL DEFAULT 'api',
  reported_to_stripe_at   TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_usage_events_org_family_meter ON billing_usage_events (org_id, product_family, meter_name);
CREATE INDEX idx_billing_usage_events_unreported ON billing_usage_events (reported_to_stripe_at);

-- ── billing_entitlement_snapshots ───────────────────────────────────

CREATE TABLE billing_entitlement_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  billing_account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  source_type       entitlement_source_type NOT NULL,
  source_id         VARCHAR(255) NOT NULL,
  entitlements_json JSONB NOT NULL,
  effective_at      TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_entitlement_snapshots_org ON billing_entitlement_snapshots (org_id);

-- ── billing_quotes ──────────────────────────────────────────────────

CREATE TABLE billing_quotes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL,
  billing_account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  stripe_quote_id    VARCHAR(255) UNIQUE,
  status             quote_status NOT NULL DEFAULT 'draft',
  expires_at         TIMESTAMPTZ,
  accepted_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_quotes_org ON billing_quotes (org_id);

-- ── billing_webhook_events ──────────────────────────────────────────

CREATE TABLE billing_webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
  type            VARCHAR(120) NOT NULL,
  processed_at    TIMESTAMPTZ,
  status          webhook_event_status NOT NULL DEFAULT 'pending',
  payload_json    JSONB NOT NULL,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_webhook_events_stripe_id ON billing_webhook_events (stripe_event_id);
CREATE INDEX idx_billing_webhook_events_status ON billing_webhook_events (status);

-- ── billing_adjustments ─────────────────────────────────────────────

CREATE TABLE billing_adjustments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL,
  billing_account_id   UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  kind                 adjustment_kind NOT NULL,
  amount               INTEGER NOT NULL,
  currency             VARCHAR(3) NOT NULL DEFAULT 'usd',
  reason               TEXT NOT NULL,
  stripe_credit_note_id VARCHAR(255),
  created_by_user_id   UUID NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_adjustments_org ON billing_adjustments (org_id);
