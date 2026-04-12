-- 001_init_migraauth.sql
-- MigraAuth — Centralized Identity Platform for the MigraTeck Ecosystem
-- PostgreSQL 16+ · database: auth_migrateck
-- ─────────────────────────────────────────────────────────────────────

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

-- ─── Extensions ─────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Enums ──────────────────────────────────────────────────────────

CREATE TYPE user_status      AS ENUM ('pending','active','locked','disabled');
CREATE TYPE credential_type  AS ENUM ('password','totp','passkey','recovery_code');
CREATE TYPE token_status     AS ENUM ('active','used','revoked','expired');
CREATE TYPE member_role      AS ENUM ('owner','admin','billing_admin','member');
CREATE TYPE member_status    AS ENUM ('invited','active','suspended');
CREATE TYPE session_type     AS ENUM ('auth','app');
CREATE TYPE audit_actor_type AS ENUM ('user','system','admin','service');

-- ─── Users ──────────────────────────────────────────────────────────

CREATE TABLE users (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext      NOT NULL UNIQUE,
  status            user_status NOT NULL DEFAULT 'pending',
  email_verified_at timestamptz,
  display_name      varchar(120),
  given_name        varchar(120),
  family_name       varchar(120),
  avatar_url        text,
  locale            varchar(10) NOT NULL DEFAULT 'en',
  timezone          varchar(60) NOT NULL DEFAULT 'UTC',
  last_login_at     timestamptz,
  locked_at         timestamptz,
  disabled_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- ─── User Credentials ───────────────────────────────────────────────

CREATE TABLE user_credentials (
  id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        credential_type NOT NULL,
  secret_hash text,
  metadata    jsonb           NOT NULL DEFAULT '{}',
  priority    smallint        NOT NULL DEFAULT 0,
  is_enabled  boolean         NOT NULL DEFAULT true,
  created_at  timestamptz     NOT NULL DEFAULT now(),
  updated_at  timestamptz     NOT NULL DEFAULT now()
);

-- ─── Email Verifications ────────────────────────────────────────────

CREATE TABLE email_verifications (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text         NOT NULL,
  status     token_status NOT NULL DEFAULT 'active',
  expires_at timestamptz  NOT NULL,
  used_at    timestamptz,
  created_at timestamptz  NOT NULL DEFAULT now()
);

-- ─── Password Resets ────────────────────────────────────────────────

CREATE TABLE password_resets (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash           text         NOT NULL,
  status               token_status NOT NULL DEFAULT 'active',
  expires_at           timestamptz  NOT NULL,
  used_at              timestamptz,
  requested_ip         inet,
  requested_user_agent text,
  created_at           timestamptz  NOT NULL DEFAULT now()
);

-- ─── OAuth Clients ──────────────────────────────────────────────────

CREATE TABLE oauth_clients (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 varchar(100) NOT NULL UNIQUE,
  client_name               varchar(120) NOT NULL,
  client_secret_hash        text,
  client_type               varchar(20)  NOT NULL CHECK (client_type IN ('web','mobile','service')),
  redirect_uris             jsonb        NOT NULL,
  post_logout_redirect_uris jsonb        NOT NULL DEFAULT '[]',
  allowed_scopes            jsonb        NOT NULL DEFAULT '["openid"]',
  requires_pkce             boolean      NOT NULL DEFAULT true,
  token_auth_method         varchar(40)  NOT NULL DEFAULT 'none'
                              CHECK (token_auth_method IN ('none','client_secret_basic','client_secret_post')),
  is_first_party            boolean      NOT NULL DEFAULT true,
  is_active                 boolean      NOT NULL DEFAULT true,
  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now()
);

-- ─── OAuth Authorization Codes ──────────────────────────────────────

CREATE TABLE oauth_authorization_codes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id             varchar(100) NOT NULL,
  code_hash             text        NOT NULL,
  code_challenge        text        NOT NULL,
  code_challenge_method varchar(10) NOT NULL CHECK (code_challenge_method IN ('S256','plain')),
  redirect_uri          text        NOT NULL,
  scope                 text        NOT NULL DEFAULT 'openid',
  nonce                 text,
  state_hash            text,
  nonce_hash            text,
  issued_ip             inet,
  issued_user_agent     text,
  expires_at            timestamptz NOT NULL,
  used_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ─── OAuth Refresh Tokens ───────────────────────────────────────────

CREATE TABLE oauth_refresh_tokens (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id         varchar(100) NOT NULL,
  token_hash        text        NOT NULL,
  family_id         uuid        NOT NULL,
  parent_token_id   uuid,
  scope             text        NOT NULL DEFAULT 'openid',
  issued_at         timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  rotated_at        timestamptz,
  revoked_at        timestamptz,
  reuse_detected_at timestamptz,
  ip_address        inet,
  user_agent        text,
  device_id         uuid
);

CREATE INDEX idx_refresh_tokens_family ON oauth_refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_hash   ON oauth_refresh_tokens(token_hash);

-- ─── Sessions ───────────────────────────────────────────────────────

CREATE TABLE sessions (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_type        session_type NOT NULL DEFAULT 'auth',
  client_id           varchar(100),
  session_secret_hash text         NOT NULL,
  device_id           uuid,
  device_name         varchar(120),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  expires_at          timestamptz  NOT NULL,
  revoked_at          timestamptz,
  last_seen_at        timestamptz,
  ip_address          inet,
  user_agent          text
);

CREATE INDEX idx_sessions_secret ON sessions(session_secret_hash);
CREATE UNIQUE INDEX idx_sessions_active_device
  ON sessions(user_id, device_id)
  WHERE revoked_at IS NULL AND device_id IS NOT NULL;

-- ─── Organizations ──────────────────────────────────────────────────

CREATE TABLE organizations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(160) NOT NULL,
  slug          varchar(120) NOT NULL UNIQUE,
  owner_user_id uuid        NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Organization Members ───────────────────────────────────────────

CREATE TABLE organization_members (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            member_role   NOT NULL DEFAULT 'member',
  status          member_status NOT NULL DEFAULT 'invited',
  joined_at       timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- ─── MFA Challenges ─────────────────────────────────────────────────

CREATE TABLE mfa_challenges (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method         varchar(20) NOT NULL CHECK (method IN ('totp','recovery_code')),
  challenge_hash text        NOT NULL,
  expires_at     timestamptz NOT NULL,
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Audit Logs ─────────────────────────────────────────────────────

CREATE TABLE audit_logs (
  id             uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid             REFERENCES users(id) ON DELETE SET NULL,
  actor_type     audit_actor_type NOT NULL DEFAULT 'user',
  target_user_id uuid             REFERENCES users(id) ON DELETE SET NULL,
  client_id      varchar(100),
  event_type     varchar(80)      NOT NULL,
  event_data     jsonb            NOT NULL DEFAULT '{}',
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_actor   ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_event   ON audit_logs(event_type);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- ─── updated_at trigger function ────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_user_credentials_updated_at
  BEFORE UPDATE ON user_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_oauth_clients_updated_at
  BEFORE UPDATE ON oauth_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Seed: First-Party OAuth Clients ────────────────────────────────

INSERT INTO oauth_clients
  (client_id, client_name, client_type, redirect_uris, post_logout_redirect_uris, allowed_scopes, is_first_party)
VALUES
  ('migradrive_web', 'MigraDrive Web', 'web',
   '["https://migradrive.com/auth/callback","http://localhost:3000/auth/callback"]'::jsonb,
   '["https://migradrive.com","http://localhost:3000"]'::jsonb,
   '["openid","profile","email","offline_access"]'::jsonb,
   true),

  ('migramail_web', 'MigraMail Web', 'web',
   '["https://migramail.com/auth/callback","http://localhost:3001/auth/callback"]'::jsonb,
   '["https://migramail.com","http://localhost:3001"]'::jsonb,
   '["openid","profile","email","offline_access"]'::jsonb,
   true),

  ('migrapanel_web', 'MigraPanel Web', 'web',
   '["https://migrapanel.com/auth/callback","https://panel.migrateck.com/auth/callback","http://localhost:3002/auth/callback"]'::jsonb,
   '["https://migrapanel.com","https://panel.migrateck.com","http://localhost:3002"]'::jsonb,
   '["openid","profile","email","offline_access","orgs:read"]'::jsonb,
   true),

  ('migravoice_web', 'MigraVoice Web', 'web',
   '["https://migravoice.com/auth/callback","http://localhost:3003/auth/callback"]'::jsonb,
   '["https://migravoice.com","http://localhost:3003"]'::jsonb,
   '["openid","profile","email","offline_access"]'::jsonb,
   true)
ON CONFLICT (client_id) DO UPDATE SET
  client_name               = EXCLUDED.client_name,
  redirect_uris             = EXCLUDED.redirect_uris,
  post_logout_redirect_uris = EXCLUDED.post_logout_redirect_uris,
  allowed_scopes            = EXCLUDED.allowed_scopes;
