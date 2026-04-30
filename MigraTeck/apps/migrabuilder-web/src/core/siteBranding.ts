// Standalone site branding — calls our Fastify API (no WordPress)
import { fetchSiteBranding as apiFetchBranding, updateSiteBranding as apiUpdateBranding } from '../api/client';

// Kept for compatibility with existing callers
export type RestApiConfig = { siteId: string };

export type SiteBrandingEnvelope = {
  customLogoId: number;
  customLogoUrl: string;
  siteIconId: number;
  siteIconUrl: string;
  canManage: boolean;
};

function toBrandingEnvelope(b: { logoUrl: string | null; iconUrl: string | null; canManage: boolean }): SiteBrandingEnvelope {
  return {
    customLogoId: 0,
    customLogoUrl: b.logoUrl ?? '',
    siteIconId: 0,
    siteIconUrl: b.iconUrl ?? '',
    canManage: b.canManage,
  };
}

export async function fetchSiteBranding(api: RestApiConfig): Promise<SiteBrandingEnvelope> {
  const b = await apiFetchBranding(api.siteId);
  return toBrandingEnvelope(b);
}

export async function updateSiteBranding(
  api: RestApiConfig,
  payload: { logoUrl?: string | null; iconUrl?: string | null },
): Promise<SiteBrandingEnvelope> {
  const b = await apiUpdateBranding(api.siteId, payload.logoUrl, payload.iconUrl);
  return toBrandingEnvelope(b);
}
