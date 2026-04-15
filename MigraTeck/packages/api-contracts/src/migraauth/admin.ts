import type { OAuthClientView } from "./developer";

export type AdminUserStatus = "PENDING" | "ACTIVE" | "LOCKED" | "DISABLED";

export interface AdminUserRow {
  id: string;
  email: string;
  status: AdminUserStatus;
  email_verified: boolean;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminMembership {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: string;
  status: string;
  joined_at: string | null;
  created_at: string;
}

export interface AdminSession {
  id: string;
  client_id: string | null;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
}

export interface AdminAuditLog {
  id: string;
  actor_user_id: string | null;
  actor_type: string;
  target_user_id: string | null;
  client_id: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AdminUserDetail {
  user: AdminUserRow & {
    locked_at: string | null;
    disabled_at: string | null;
  };
  memberships: AdminMembership[];
  sessions: AdminSession[];
  recent_audit: AdminAuditLog[];
}

export interface AdminClientRow extends OAuthClientView {}

export interface MigraAuthAdminUserSearchRequest {
  q?: string;
  status?: AdminUserStatus;
  limit?: number;
  offset?: number;
}

export interface MigraAuthAdminUsersResponse {
  users: AdminUserRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface MigraAuthAdminUserDetailResponse {
  user: AdminUserDetail["user"];
  memberships: AdminMembership[];
  sessions: AdminSession[];
  recent_audit: AdminAuditLog[];
}

export interface MigraAuthAdminActionReasonRequest {
  reason: string;
}

export interface MigraAuthAdminClientSearchRequest {
  q?: string;
  is_active?: boolean | string;
  limit?: number;
  offset?: number;
}

export interface MigraAuthAdminClientsResponse {
  clients: AdminClientRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface MigraAuthAdminAuditSearchRequest {
  user_id?: string;
  event_type?: string;
  client_id?: string;
  limit?: number;
  offset?: number;
}

export interface MigraAuthAdminAuditResponse {
  audit_logs: AdminAuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface MigraAuthAdminActionResponse {
  success: boolean;
  message: string;
}