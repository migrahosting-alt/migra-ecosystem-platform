-- Durable workforce product-provisioning outbox.
--
-- Kept separate from migration 015 because 015 may already be applied in
-- deployed MigraAuth environments. Authority mutations and this outbox row are
-- written in the same transaction; the worker later delivers signed snapshots.

CREATE TABLE IF NOT EXISTS workforce_provisioning_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workforce_profile_id UUID NOT NULL
    REFERENCES workforce_profiles(id) ON DELETE CASCADE,
  staff_id VARCHAR(48) NOT NULL,
  product workforce_product NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  entitlement_revision INTEGER NOT NULL,
  product_access_active BOOLEAN NOT NULL,
  role_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  grant_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  related_grant_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ NULL,
  last_error VARCHAR(1000) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_provisioning_outbox_revision_positive
    CHECK (entitlement_revision >= 1),
  CONSTRAINT workforce_provisioning_outbox_attempt_nonnegative
    CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS workforce_provisioning_outbox_delivery_idx
  ON workforce_provisioning_outbox (delivered_at, next_attempt_at);
CREATE INDEX IF NOT EXISTS workforce_provisioning_outbox_product_delivery_idx
  ON workforce_provisioning_outbox (product, delivered_at, next_attempt_at);
CREATE INDEX IF NOT EXISTS workforce_provisioning_outbox_profile_revision_idx
  ON workforce_provisioning_outbox
    (workforce_profile_id, product, entitlement_revision);

COMMENT ON TABLE workforce_provisioning_outbox IS
  'Durable signed product-authority delivery queue. Rows are immutable authority snapshots except for delivery-attempt metadata.';
