-- MigraPanel console: staff identity + RBAC for the Mail (MigraMail) module.
-- Lives in the migrapanel database (same DB the console reads via panelQuery).
-- The console owns identity/login; mailbox grants live in MigraMail keyed by
-- this email + role. The env bootstrap admin (CONSOLE_ADMIN_EMAIL) is always
-- treated as super_admin and does not need a row here.
--
-- Apply once against migrapanel:
--   psql "$MIGRAPANEL_DB_URL" -f 001_mail_staff_user.sql

CREATE TABLE IF NOT EXISTS mail_staff_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text,
  role          text NOT NULL DEFAULT 'readonly'
                  CHECK (role IN ('super_admin','admin','support','billing','sales','readonly')),
  department    text,
  password_hash text,                       -- scrypt:<saltHex>:<hashHex> (same scheme as console admin)
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_staff_user_email_idx ON mail_staff_user (lower(email));
