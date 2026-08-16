export type AuthClientConfig = {
  /**
   * The issuer origin the BROWSER is sent to (`/authorize`). It must be an
   * origin the end user's browser can reach.
   */
  migraAuthBaseUrl: string;
  migraAuthWebUrl?: string;
  /**
   * The origin THIS SERVER calls for the back-channel (`/token`, `/userinfo`).
   * Defaults to `migraAuthBaseUrl`.
   *
   * These are two different reachability questions and conflating them is a
   * deployment trap. MigraPilot hit it: the consumer runs on a VM behind the
   * same public address that serves `auth.migrateck.com`, so the browser
   * reached the issuer normally while the server's own connection to that
   * address hairpinned and timed out. Authorization succeeded, a real code came
   * back, and every token exchange failed. Setting this to the private path
   * (a Tailscale address) fixes the back channel without moving the browser off
   * the public origin.
   */
  migraAuthApiUrl?: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  postLogoutRedirectUri?: string;
  appBaseUrl: string;
  scopes: string[];
  sessionCookieName: string;
  sessionSecret: string;
  /**
   * Application session lifetime in seconds. Defaults to the access token's.
   *
   * Set this only when the app stops using the access token after bootstrap;
   * see `appSessionLifetimeMs` in `./bootstrap.ts` for the trade-off it accepts.
   */
  sessionTtlSeconds?: number;
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
  emailVerified: boolean;
  displayName?: string;
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}) => Promise<BootstrapResult>;
