-- 008_client_branding.sql
-- Additive, non-destructive: registry-driven branding fields on oauth_clients.
-- Safe to re-run (IF NOT EXISTS). No data loss; no changes to existing columns.
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS default_post_login_url varchar(500);
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS support_url varchar(500);
