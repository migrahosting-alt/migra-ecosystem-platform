import { authFetch } from "@/lib/api";
import type {
  ClientMutationPayload,
  MigraAuthCreateOAuthClientResponse,
  MigraAuthDeveloperClientsResponse,
  MigraAuthDisableOAuthClientResponse,
  MigraAuthListOrganizationsResponse,
  MigraAuthRotateClientSecretResponse,
  MigraAuthUpdateOAuthClientResponse,
  OAuthClientView,
  OrganizationSummary,
} from "@migrateck/api-contracts";

export type { ClientMutationPayload, OAuthClientView, OrganizationSummary };

export async function listDeveloperClients() {
  return authFetch<MigraAuthDeveloperClientsResponse>("/v1/clients");
}

export async function getDeveloperClient(clientId: string) {
  return authFetch<MigraAuthUpdateOAuthClientResponse>(`/v1/clients/${clientId}`);
}

export async function createDeveloperClient(payload: ClientMutationPayload) {
  return authFetch<MigraAuthCreateOAuthClientResponse>("/v1/clients", {
    method: "POST",
    body: payload,
  });
}

export async function updateDeveloperClient(
  clientId: string,
  payload: Partial<Omit<ClientMutationPayload, "client_type" | "token_auth_method" | "owner_org_id" | "description">> & {
    is_active?: boolean;
    description?: string | null;
  },
) {
  return authFetch<MigraAuthUpdateOAuthClientResponse>(`/v1/clients/${clientId}`, {
    method: "PATCH",
    body: payload,
  });
}

export async function rotateDeveloperClientSecret(clientId: string) {
  return authFetch<MigraAuthRotateClientSecretResponse>(`/v1/clients/${clientId}/rotate-secret`, {
    method: "POST",
  });
}

export async function deactivateDeveloperClient(clientId: string) {
  return authFetch<MigraAuthDisableOAuthClientResponse>(`/v1/clients/${clientId}`, {
    method: "DELETE",
  });
}

export async function listOrganizations() {
  return authFetch<MigraAuthListOrganizationsResponse>("/v1/organizations");
}

export function parseLines(input: string): string[] {
  return input
    .split(/\r?\n|,/) 
    .map((value) => value.trim())
    .filter(Boolean);
}

export function formatLines(values: string[]): string {
  return values.join("\n");
}