export type AuthClientConfig = {
  migraAuthBaseUrl: string;
  migraAuthWebUrl?: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  postLogoutRedirectUri?: string;
  appBaseUrl: string;
  scopes: string[];
  sessionCookieName: string;
  sessionSecret: string;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName?: string;
};

export type ResolvedOrg = {
  id: string;
  name: string;
  role: string;
};

export type BootstrapResult = {
  activeOrg: ResolvedOrg | null;
  permissions: string[];
  productAccount?: Record<string, unknown> | null;
};

export type MeResponse = {
  user: AuthenticatedUser;
  activeOrg: ResolvedOrg | null;
  permissions: string[];
  productAccount: Record<string, unknown> | null;
};

export type AppSession = {
  sessionId: string;
  authUserId: string;
  email: string;
  displayName?: string;
  activeOrgId?: string;
  activeOrgName?: string;
  activeOrgRole?: string;
  permissions: string[];
  productAccount?: Record<string, unknown> | null;
  createdAt: number;
  expiresAt: number;
};

export type BootstrapFn = (input: {
  authUserId: string;
  email: string;
  displayName?: string;
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}) => Promise<BootstrapResult>;
