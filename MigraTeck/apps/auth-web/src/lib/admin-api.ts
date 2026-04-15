import { authFetch } from "@/lib/api";
import type {
  AdminAuditLog,
  AdminClientRow,
  AdminUserDetail,
  AdminUserRow,
  MigraAuthAdminActionResponse,
  MigraAuthAdminAuditResponse,
  MigraAuthAdminClientsResponse,
  MigraAuthAdminUserDetailResponse,
  MigraAuthAdminUsersResponse,
} from "@migrateck/api-contracts";

export async function listAdminUsers(params: {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.status) searchParams.set("status", params.status);
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params.offset !== undefined) searchParams.set("offset", String(params.offset));
  return authFetch<MigraAuthAdminUsersResponse>(
    `/v1/admin/users${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
  );
}

export async function getAdminUser(userId: string) {
  return authFetch<MigraAuthAdminUserDetailResponse>(`/v1/admin/users/${userId}`);
}

export async function adminUserAction(userId: string, action: "lock" | "unlock" | "disable", reason: string) {
  return authFetch<MigraAuthAdminActionResponse>(`/v1/admin/users/${userId}/${action}`, {
    method: "POST",
    body: { reason },
  });
}

export async function listAdminClients(params: {
  q?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
} = {}) {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.is_active !== undefined) searchParams.set("is_active", String(params.is_active));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params.offset !== undefined) searchParams.set("offset", String(params.offset));
  return authFetch<MigraAuthAdminClientsResponse>(
    `/v1/admin/clients${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
  );
}

export async function listAdminAudit(params: {
  user_id?: string;
  event_type?: string;
  client_id?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const searchParams = new URLSearchParams();
  if (params.user_id) searchParams.set("user_id", params.user_id);
  if (params.event_type) searchParams.set("event_type", params.event_type);
  if (params.client_id) searchParams.set("client_id", params.client_id);
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params.offset !== undefined) searchParams.set("offset", String(params.offset));
  return authFetch<MigraAuthAdminAuditResponse>(
    `/v1/admin/audit${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
  );
}

export type { AdminAuditLog, AdminClientRow, AdminUserDetail, AdminUserRow };