-- 005_unified_identifier_auth.sql
-- Add first-class identifiers and reusable verification challenges.

CREATE TYPE identifier_kind AS ENUM ('email', 'phone');
CREATE TYPE verification_challenge_kind AS ENUM (
  'signup_verify',
  'login_stepup',
  'reset_password',
  'add_identifier',
  'change_identifier'
);
CREATE TYPE verification_channel AS ENUM ('email', 'sms');

ALTER TABLE users
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN phone_e164 varchar(20),
  ADD COLUMN phone_verified_at timestamptz;

CREATE UNIQUE INDEX users_phone_e164_key ON users(phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE user_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind identifier_kind NOT NULL,
  normalized_value varchar(320) NOT NULL,
  display_value varchar(320),
  is_verified boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, normalized_value)
);

CREATE INDEX idx_user_identifiers_user_kind
  ON user_identifiers(user_id, kind);

CREATE TRIGGER trg_user_identifiers_updated_at
  BEFORE UPDATE ON user_identifiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO user_identifiers (
  user_id,
  kind,
  normalized_value,
  display_value,
  is_verified,
  is_primary,
  verified_at
)
SELECT
  id,
  'email'::identifier_kind,
  lower(email::text),
  email::text,
  email_verified_at IS NOT NULL,
  true,
  email_verified_at
FROM users
WHERE email IS NOT NULL
ON CONFLICT (kind, normalized_value) DO NOTHING;

CREATE TABLE verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  identifier_id uuid REFERENCES user_identifiers(id) ON DELETE CASCADE,
  kind verification_challenge_kind NOT NULL,
  channel verification_channel NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text,
  risk_score integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_verification_challenges_identifier_kind
  ON verification_challenges(identifier_id, kind, created_at DESC);

CREATE INDEX idx_verification_challenges_user_kind
  ON verification_challenges(user_id, kind, created_at DESC);
