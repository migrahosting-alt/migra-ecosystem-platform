-- ─────────────────────────────────────────────────────────────────────
-- Per-product external-provider apps
--
-- WHY THIS COLUMN EXISTS. Google renders the consent screen of the PROJECT that
-- owns the OAuth client — one brand per project, shared by every client inside
-- it. With a single ecosystem-wide Google app, every product signing in through
-- MigraAuth showed the same name, and no per-client setting could change it:
-- someone signing into MigraPilot read "Continue to MigraTeck". Giving a
-- product its own Google project, and therefore its own client, is the only way
-- its consent screen can name it.
--
-- WHICH APP STARTED THE TRIP MUST SURVIVE THE TRIP. The authorization code
-- Google returns can only be redeemed by the client it was issued to, so the
-- callback has to exchange with the SAME app the redirect used. The login-state
-- row is what already carries start-time facts across the provider round trip —
-- the PKCE verifier, the nonce, the transaction being interrupted — and this is
-- one more of them.
--
-- IT IS NOT DERIVED FROM THE TRANSACTION AT CALLBACK TIME ON PURPOSE. A
-- transaction that lapses mid-flight would leave the exchange guessing, and
-- guessing wrong means redeeming a code against the wrong client: an
-- `invalid_grant` reported as a provider fault, hiding an expiry the user could
-- have been told about plainly.
--
-- NULLABLE, and null means the shared app. Every state row that already exists,
-- and every sign-in that is not completing a product's authorization request
-- (MigraAuth's own login, linking a provider from settings), reads as "the
-- shared credential" — which is exactly what it was.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE social_login_states
  ADD COLUMN IF NOT EXISTS product_client_id VARCHAR(128) NULL;

COMMENT ON COLUMN social_login_states.product_client_id IS
  'The MigraAuth client (product) this provider trip was started for, when the product has its own provider app. The callback MUST exchange the code with the same app the redirect used. Null means the shared ecosystem credential.';
