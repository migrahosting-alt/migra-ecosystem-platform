export interface MigraAuthSessionRow {
  id: string;
  session_type: string;
  client_id: string | null;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  device_name: string | null;
  current: boolean;
}

export interface MigraAuthSessionsResponse {
  sessions: MigraAuthSessionRow[];
}

export interface MigraAuthRevokeSessionResponse {
  revoked: true;
}

export interface MigraAuthRevokeAllSessionsRequest {
  include_current?: boolean;
}

export interface MigraAuthRevokeAllSessionsResponse {
  revoked_count: number;
}