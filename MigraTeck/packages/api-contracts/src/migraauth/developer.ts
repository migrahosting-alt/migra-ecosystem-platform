import type { OrganizationSummary } from "./orgs";

export type DeveloperClientType = "web" | "spa" | "native" | "service";
export type DeveloperTokenAuthMethod = "none" | "client_secret_basic" | "client_secret_post";

export interface OAuthClientView {
  id: string;
  client_id: string;
  client_name: string;
  description: string | null;
  client_type: DeveloperClientType;
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  allowed_scopes: string[];
  requires_pkce: boolean;
  token_auth_method: DeveloperTokenAuthMethod;
  is_first_party: boolean;
  is_active: boolean;
  owner_user_id: string | null;
  owner_org_id: string | null;
  owner_organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface ClientMutationPayload {
  client_name: string;
  description?: string;
  client_type: DeveloperClientType;
  redirect_uris: string[];
  post_logout_redirect_uris?: string[];
  allowed_scopes: string[];
  requires_pkce?: boolean;
  token_auth_method?: DeveloperTokenAuthMethod;
  owner_org_id?: string;
}

export interface MigraAuthCreateOAuthClientRequest {
  client_name: string;
  description?: string;
  client_type: DeveloperClientType;
  redirect_uris: string[];
  post_logout_redirect_uris?: string[];
  allowed_scopes: string[];
  requires_pkce?: boolean;
  token_auth_method?: DeveloperTokenAuthMethod;
  owner_org_id?: string;
}

export interface MigraAuthCreateOAuthClientResponse {
  client: OAuthClientView;
  client_secret: string | null;
}

export interface MigraAuthUpdateOAuthClientRequest {
  client_name?: string;
  description?: string | null;
  redirect_uris?: string[];
  post_logout_redirect_uris?: string[];
  allowed_scopes?: string[];
  requires_pkce?: boolean;
  is_active?: boolean;
}

export interface MigraAuthUpdateOAuthClientResponse {
  client: OAuthClientView;
}

export interface MigraAuthRotateClientSecretResponse {
  client: OAuthClientView;
  client_secret: string;
}

export interface MigraAuthDisableOAuthClientResponse {
  deactivated: true;
}

export interface MigraAuthDeveloperClientsResponse {
  clients: OAuthClientView[];
}

export type MigraAuthListOrganizationsResponse = { organizations: OrganizationSummary[] };