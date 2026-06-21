export type EcosystemPortalKey =
  | "migrateck_web"
  | "migrahosting_web"
  | "migrahosting_client_portal"
  | "migrapanel_web"
  | "migradrive_web"
  | "migramail_web"
  | "migravoice_web";

export type PortalAuthAuthority = "central" | "legacy-local";

export type PortalBootstrapAuthority = "panel-api" | "product-app";

export type PortalRedirectStrategy = "same-origin-callback" | "portal-callback-bridge";

export type PortalRelyingPartyDefinition = {
  key: string;
  label: string;
  publicHosts: string[];
  clientId: EcosystemPortalKey;
  redirectPath: string;
  logoutPath: string;
  authority: PortalAuthAuthority;
  bootstrapAuthority: PortalBootstrapAuthority;
  redirectStrategy: PortalRedirectStrategy;
};

export type ResolvedPortalAuthTarget = {
  key: string;
  host: string;
  clientId: EcosystemPortalKey;
  redirectPath: string;
  logoutPath: string;
  authority: PortalAuthAuthority;
  bootstrapAuthority: PortalBootstrapAuthority;
  redirectStrategy: PortalRedirectStrategy;
};
