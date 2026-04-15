import type { MigraAuthJsonObject } from "./common";

export interface MigraAuthAuthorizeQuery {
  response_type: "code";
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
  scope?: string;
  nonce?: string;
  prompt?: "none" | "login" | "consent";
  login_hint?: string;
  return_to?: string;
}

export interface MigraAuthAuthorizeCompleteRequest extends MigraAuthAuthorizeQuery {}

export interface MigraAuthAuthorizeCompleteResponse {
  redirect_uri: string;
  code: string;
  state: string;
}

export interface MigraAuthTokenRequest {
  grant_type: "authorization_code" | "refresh_token";
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
  client_id: string;
  client_secret?: string;
  refresh_token?: string;
}

export interface MigraAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope: string;
}

export interface MigraAuthRevokeTokenRequest {
  token: string;
  token_type_hint?: "refresh_token" | "access_token";
}

export interface MigraAuthRevokeTokenResponse {
  revoked: true;
}

export interface MigraAuthUserinfoResponse {
  sub: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  locale?: string;
}

export interface MigraAuthOpenIdConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  scopes_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  claims_supported: string[];
  code_challenge_methods_supported: string[];
}

export interface MigraAuthJwksResponse {
  keys: MigraAuthJsonObject[];
}