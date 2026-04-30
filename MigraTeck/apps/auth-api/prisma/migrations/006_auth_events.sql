-- 006_auth_events.sql
-- Add a durable auth-specific event stream for signup, login, refresh, reset, and session activity.

CREATE TABLE auth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  identifier varchar(320),
  event_type varchar(80) NOT NULL,
  success boolean NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_events_user_created_at
  ON auth_events(user_id, created_at DESC);

CREATE INDEX idx_auth_events_identifier_created_at
  ON auth_events(identifier, created_at DESC);

CREATE INDEX idx_auth_events_event_type_created_at
  ON auth_events(event_type, created_at DESC);

CREATE INDEX idx_auth_events_created_at
  ON auth_events(created_at DESC);
