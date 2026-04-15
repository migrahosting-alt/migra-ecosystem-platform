export const migraAuthUserStatuses = [
  "ACTIVE",
  "PENDING_VERIFICATION",
  "LOCKED",
  "DISABLED",
] as const;

export type MigraAuthUserStatus = (typeof migraAuthUserStatuses)[number];

export const migraAuthSessionStatuses = ["ACTIVE", "REVOKED", "EXPIRED"] as const;
export type MigraAuthSessionStatus = (typeof migraAuthSessionStatuses)[number];

export const migraAuthOrgRoles = [
  "OWNER",
  "ADMIN",
  "EDITOR",
  "BILLING",
  "SUPPORT",
  "MEMBER",
  "VIEWER",
] as const;
export type MigraAuthOrgRole = (typeof migraAuthOrgRoles)[number];

export const migraAuthInvitationStatuses = ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"] as const;
export type MigraAuthInvitationStatus = (typeof migraAuthInvitationStatuses)[number];

export const migraAuthMfaMethodTypes = ["TOTP", "WEBAUTHN", "RECOVERY_CODE"] as const;
export type MigraAuthMfaMethodType = (typeof migraAuthMfaMethodTypes)[number];

export const migraAuthOAuthClientTypes = ["FIRST_PARTY", "THIRD_PARTY", "INTERNAL_SERVICE"] as const;
export type MigraAuthOAuthClientType = (typeof migraAuthOAuthClientTypes)[number];

export const migraAuthOAuthOwnershipTypes = ["USER", "ORG", "PLATFORM"] as const;
export type MigraAuthOAuthOwnershipType = (typeof migraAuthOAuthOwnershipTypes)[number];

export const migraAuthGrantStatuses = ["ACTIVE", "REVOKED", "EXPIRED"] as const;
export type MigraAuthGrantStatus = (typeof migraAuthGrantStatuses)[number];

export const migraAuthVerificationTokenTypes = [
  "EMAIL_VERIFICATION",
  "PASSWORD_RESET",
  "INVITATION",
  "EMAIL_CHANGE",
] as const;
export type MigraAuthVerificationTokenType = (typeof migraAuthVerificationTokenTypes)[number];

export const migraAuthPlatformRoles = [
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN",
  "PLATFORM_SUPPORT",
  "PLATFORM_SECURITY_ANALYST",
] as const;
export type MigraAuthPlatformRole = (typeof migraAuthPlatformRoles)[number];

export const migraAuthSecurityEventSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type MigraAuthSecurityEventSeverity = (typeof migraAuthSecurityEventSeverities)[number];

export const migraAuthSecurityEventStatuses = ["OPEN", "RESOLVED", "IGNORED"] as const;
export type MigraAuthSecurityEventStatus = (typeof migraAuthSecurityEventStatuses)[number];

export const migraAuthAuditActorTypes = ["USER", "SYSTEM", "INTERNAL_SERVICE", "ADMIN"] as const;
export type MigraAuthAuditActorType = (typeof migraAuthAuditActorTypes)[number];

export const migraAuthSigningKeyStatuses = ["ACTIVE", "NEXT", "RETIRED", "REVOKED"] as const;
export type MigraAuthSigningKeyStatus = (typeof migraAuthSigningKeyStatuses)[number];

export type MigraAuthJsonObject = Record<string, unknown>;

export interface MigraAuthUserView {
  id: string;
  email: string;
  email_normalized?: string | null;
  email_verified_at: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  locale: string | null;
  timezone: string | null;
  status: MigraAuthUserStatus;
  locked_at: string | null;
  disabled_at: string | null;
  last_login_at: string | null;
  password_changed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MigraAuthOrganizationView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_user_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MigraAuthMembershipView {
  id: string;
  org_id: string;
  user_id?: string;
  role: MigraAuthOrgRole;
  joined_at: string | null;
  invited_by_user_id?: string | null;
  created_at: string;
  updated_at?: string;
  organization?: MigraAuthOrganizationView;
}

export interface MigraAuthSessionView {
  id: string;
  status: MigraAuthSessionStatus;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  country?: string | null;
  city?: string | null;
  last_seen_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  current?: boolean;
}

export interface MigraAuthMfaMethodView {
  id: string;
  type: MigraAuthMfaMethodType;
  label: string | null;
  verified_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface MigraAuthPasskeyView {
  id: string;
  credential_id: string;
  nickname: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface MigraAuthInvitationView {
  id: string;
  org_id: string;
  email: string;
  role: MigraAuthOrgRole;
  status: MigraAuthInvitationStatus;
  invited_by_user_id: string;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MigraAuthOAuthClientView {
  id: string;
  client_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  type: MigraAuthOAuthClientType;
  ownership_type: MigraAuthOAuthOwnershipType;
  owner_user_id: string | null;
  owner_org_id: string | null;
  is_active: boolean;
  is_public: boolean;
  first_party: boolean;
  require_pkce: boolean;
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  allowed_scopes: string[];
  allowed_audiences: string[];
  token_auth_method: string | null;
  logo_url: string | null;
  website_url: string | null;
  privacy_policy_url: string | null;
  terms_of_service_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface MigraAuthAuditEventView {
  id: string;
  actor_user_id: string | null;
  actor_type: MigraAuthAuditActorType;
  org_id: string | null;
  client_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: MigraAuthJsonObject | null;
  created_at: string;
}

export interface MigraAuthSecurityEventView {
  id: string;
  user_id: string | null;
  org_id: string | null;
  severity: MigraAuthSecurityEventSeverity;
  status: MigraAuthSecurityEventStatus;
  event_type: string;
  title: string;
  description: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: MigraAuthJsonObject | null;
  detected_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MigraAuthSigningKeyView {
  id: string;
  kid: string;
  algorithm: string;
  public_jwk: MigraAuthJsonObject;
  status: MigraAuthSigningKeyStatus;
  activated_at: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MigraAuthPageInfo {
  total: number;
  limit: number;
  offset: number;
}

export type MigraAuthPermission =
  | "auth.user.read"
  | "auth.user.write"
  | "auth.user.lock"
  | "auth.user.disable"
  | "auth.session.revoke"
  | "auth.audit.read"
  | "auth.org.read"
  | "auth.org.write"
  | "auth.client.read"
  | "auth.client.write"
  | "auth.client.secret.rotate"
  | "auth.policy.manage"
  | "org.read"
  | "org.update"
  | "org.delete"
  | "org.members.read"
  | "org.members.manage"
  | "org.invites.manage"
  | "org.security.manage"
  | "org.apps.manage"
  | "org.billing.read"
  | "org.billing.manage"
  | "openid"
  | "profile"
  | "email"
  | "offline_access"
  | "builder:read"
  | "builder:write"
  | "builder:publish"
  | "hosting:read"
  | "hosting:manage"
  | "billing:read"
  | "billing:manage";