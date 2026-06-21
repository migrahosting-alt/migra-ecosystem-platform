import { normalizePortalHost, hostMatchesPortal } from "./hosts";
import { PORTAL_RELYING_PARTIES } from "./registry";
import type { PortalRelyingPartyDefinition, ResolvedPortalAuthTarget } from "./types";

export function resolvePortalAuthTarget(host: string | null | undefined): ResolvedPortalAuthTarget | null {
  const normalizedHost = normalizePortalHost(host);
  if (!normalizedHost) {
    return null;
  }

  const match = PORTAL_RELYING_PARTIES.find((portal) => hostMatchesPortal(normalizedHost, portal.publicHosts));
  if (!match) {
    return null;
  }

  return {
    key: match.key,
    host: normalizedHost,
    clientId: match.clientId,
    redirectPath: match.redirectPath,
    logoutPath: match.logoutPath,
    authority: match.authority,
    bootstrapAuthority: match.bootstrapAuthority,
    redirectStrategy: match.redirectStrategy,
  };
}

export function listPortalAuthTargets(): PortalRelyingPartyDefinition[] {
  return [...PORTAL_RELYING_PARTIES];
}
