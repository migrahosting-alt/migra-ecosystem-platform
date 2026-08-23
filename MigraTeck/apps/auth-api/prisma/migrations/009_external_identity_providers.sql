-- 009_external_identity_providers.sql
-- Sign in with Google or GitHub, against the SAME canonical MigraAuth user.
--
-- The account model does not change. An external identity is a link to a user,
-- never a second kind of user — so a person who signs up with a password and
-- later adds Google is one account with two ways in, and every downstream
-- consumer (sessions, OIDC subjects, org membership, billing) is untouched.
--
-- KEYED ON THE PROVIDER'S SUBJECT, NOT THE EMAIL. Google `sub` and GitHub's
-- numeric id are immutable; the addresses attached to them are not, and can be
-- released and re-registered. Keying on email would mean a person changing
-- their address becomes a stranger, and a stranger acquiring an old address
-- becomes them.

CREATE TYPE identity_provider AS ENUM ('google', 'github');

CREATE TABLE user_linked_identities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            identity_provider NOT NULL,
  provider_account_id varchar(255) NOT NULL,
  email               citext,
  -- What the PROVIDER asserted, kept apart from MigraAuth's own verification
  -- state. The linking rules need both, and one column could not tell
  -- "Google says this address is theirs" from "we mailed a code and they
  -- returned it".
  email_verified      boolean NOT NULL DEFAULT false,
  display_name        varchar(200),
  avatar_url          text,
  linked_at           timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz
);

-- One external account belongs to exactly one MigraAuth user. This is what
-- makes "sign in with Google" deterministic rather than a lookup that could
-- return two rows, and what stops an external account being moved between
-- MigraAuth users without an explicit unlink.
CREATE UNIQUE INDEX idx_linked_identity_provider_account
  ON user_linked_identities(provider, provider_account_id);

-- And a user links each provider at most once: two Google accounts on one user
-- are ambiguous at sign-in, because either could resolve the session.
CREATE UNIQUE INDEX idx_linked_identity_user_provider
  ON user_linked_identities(user_id, provider);

CREATE INDEX idx_linked_identity_user
  ON user_linked_identities(user_id);

-- Sign-in flow state: the CSRF `state`, the PKCE verifier, and where to return.
--
-- SERVER-SIDE AND SINGLE-USE, deliberately. Holding the verifier in a cookie
-- would work for one browser and fail the moment a provider bounces the user
-- through a different context; holding `return_to` in the URL would hand an
-- attacker the redirect. Consumed rows are kept briefly rather than deleted so
-- a REPLAYED state is recognised as replay and refused, instead of looking
-- indistinguishable from an expired one.
CREATE TABLE social_login_states (
  state          varchar(128) PRIMARY KEY,
  provider       identity_provider NOT NULL,
  -- 'login' starts or resumes a session; 'link' attaches to the session's user.
  mode           varchar(16) NOT NULL,
  code_verifier  varchar(255) NOT NULL,
  nonce          varchar(128) NOT NULL,
  -- Validated against the allowlist BEFORE it is stored, and again on use.
  return_to      text NOT NULL,
  link_user_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  ip_address     inet,
  user_agent     text,
  consumed_at    timestamptz,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_login_states_expires_at
  ON social_login_states(expires_at);
