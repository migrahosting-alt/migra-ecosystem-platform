-- 010_authorization_transactions.sql
-- The authorization request, held by the SERVER for its whole life.
--
-- WHY THIS EXISTS. An OIDC authorization request was carried through login as a
-- dozen query parameters: `/authorize` copied them into the login URL, the login
-- page carried them onward, and `/authorize/complete` re-parsed them from the
-- browser to issue the code. Every hop was a chance to lose one — and losing one
-- is not a degraded flow, it is an invalid request that MigraAuth must reject.
-- It did exactly that, in front of a user who had just signed in successfully.
--
-- Now the browser carries ONE opaque reference. The request is reconstructed
-- from this row and nowhere else, so a parameter cannot be dropped, reordered,
-- truncated by a redirect, or edited between hops. The properties that used to
-- depend on every hop preserving them — client binding, redirect equality, PKCE
-- binding, the client's own `state` — become properties of a single row.
--
-- It also removes a class of attack rather than mitigating it: there is no
-- browser-supplied `redirect_uri` at code-issuance time to compare against,
-- because the only one that exists is the one validated when the transaction was
-- created.

CREATE TABLE authorization_transactions (
  -- Opaque and unguessable. The ONLY thing the browser ever holds.
  id                    varchar(128) PRIMARY KEY,

  -- The request, exactly as validated at creation. Never re-read from a browser.
  client_id             varchar(255) NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri          text NOT NULL,
  response_type         varchar(32) NOT NULL,
  scope                 text NOT NULL,
  -- The CLIENT's state, echoed back untouched at the end. Distinct from the
  -- social-provider state in `social_login_states`: that one protects the
  -- MigraAuth↔provider hop, this one protects the client↔MigraAuth hop, and
  -- conflating them would let one flow's protection stand in for the other's.
  client_state          text NOT NULL,
  code_challenge        varchar(255) NOT NULL,
  code_challenge_method varchar(16) NOT NULL,
  nonce                 text,
  prompt                varchar(32),
  login_hint            varchar(320),

  -- The interruption, when the user left to a provider and came back.
  provider              identity_provider,

  -- The outcome.
  user_id               uuid REFERENCES users(id) ON DELETE CASCADE,
  -- Retained after use rather than deleted, so a REPLAYED reference is
  -- recognisable as a replay and refused as one — instead of being
  -- indistinguishable from an expired or invented id.
  consumed_at           timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  ip_address            inet,
  user_agent            text
);

CREATE INDEX idx_authorization_transactions_expires
  ON authorization_transactions(expires_at);

CREATE INDEX idx_authorization_transactions_user
  ON authorization_transactions(user_id);

-- The provider round trip must know WHICH authorization request it is
-- interrupting. Held here rather than in the URL for the same reason as
-- everything else in this migration: a browser cannot alter what it never
-- carries.
ALTER TABLE social_login_states
  ADD COLUMN transaction_id varchar(128)
  REFERENCES authorization_transactions(id) ON DELETE CASCADE;
