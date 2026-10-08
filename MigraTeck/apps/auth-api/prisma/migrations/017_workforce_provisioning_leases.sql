-- Coordinate durable workforce provisioning across horizontally scaled workers.
-- Existing outbox rows remain immediately claimable because both lease columns
-- are nullable. A crashed worker's claim naturally expires and can be retried.

ALTER TABLE workforce_provisioning_outbox
  ADD COLUMN IF NOT EXISTS lease_owner VARCHAR(120),
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS workforce_provisioning_outbox_claim_idx
  ON workforce_provisioning_outbox
    (delivered_at, next_attempt_at, lease_expires_at);

COMMENT ON COLUMN workforce_provisioning_outbox.lease_owner IS
  'Ephemeral dispatcher instance holding the current delivery lease.';

COMMENT ON COLUMN workforce_provisioning_outbox.lease_expires_at IS
  'Crash-safe delivery claim expiry; rows may be reclaimed after this time.';
