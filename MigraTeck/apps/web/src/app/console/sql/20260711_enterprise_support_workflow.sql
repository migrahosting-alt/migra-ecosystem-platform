BEGIN;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS assignment_state text NOT NULL DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_by text,
  ADD COLUMN IF NOT EXISTS resolution_category text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymous_visitor_id text,
  ADD COLUMN IF NOT EXISTS ip_hash text,
  ADD COLUMN IF NOT EXISTS user_agent_hash text,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'website';

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS client_message_id text,
  ADD COLUMN IF NOT EXISTS sequence_no bigint,
  ADD COLUMN IF NOT EXISTS delivery_state text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_conversation_client_message_uidx
  ON chat_messages ("conversationId", client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_conversation_sequence_uidx
  ON chat_messages ("conversationId", sequence_no)
  WHERE sequence_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_conversation_audit (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  tenant_id text,
  actor_user_id text,
  actor_label text,
  event_type text NOT NULL,
  from_state text,
  to_state text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_conversation_audit_conversation_idx
  ON support_conversation_audit (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS support_conversation_ratings (
  id text PRIMARY KEY,
  conversation_id text NOT NULL UNIQUE REFERENCES chat_conversations(id) ON DELETE CASCADE,
  tenant_id text,
  assigned_user_id text,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  issue_resolved boolean NOT NULL,
  feedback text,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  submitted_at timestamptz NOT NULL DEFAULT now(),
  corrected_at timestamptz,
  corrected_by text
);
CREATE INDEX IF NOT EXISTS support_conversation_ratings_agent_idx
  ON support_conversation_ratings (assigned_user_id, submitted_at);

UPDATE chat_conversations
   SET assignment_state = CASE
     WHEN status IN ('closed', 'ended') THEN 'ended'
     WHEN status = 'resolved' THEN 'resolved'
     WHEN "assignedUserId" IS NOT NULL AND status = 'waiting_on_customer' THEN 'waiting_on_customer'
     WHEN "assignedUserId" IS NOT NULL THEN 'active'
     WHEN mode = 'human' THEN 'waiting_for_agent'
     ELSE 'unassigned'
   END
 WHERE assignment_state = 'unassigned';

COMMIT;
