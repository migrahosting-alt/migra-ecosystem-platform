import { ref } from 'vue';
import type { RestApiConfig, SiteBrandingEnvelope } from './siteBranding';
import { fetchSiteBranding, updateSiteBranding } from './siteBranding';

export const siteBranding = ref<SiteBrandingEnvelope>({
  customLogoId: 0,
  customLogoUrl: '',
  siteIconId: 0,
  siteIconUrl: '',
  canManage: false,
});

let apiConfig: RestApiConfig | null = null;

export function initSiteBranding(
  api: RestApiConfig,
  initial?: { siteIconUrl?: string; canManage?: boolean },
) {
  apiConfig = api;
  if (initial?.siteIconUrl) siteBranding.value.siteIconUrl = String(initial.siteIconUrl || '').trim();
  if (typeof initial?.canManage === 'boolean') siteBranding.value.canManage = initial.canManage;
}

export async function loadSiteBranding(): Promise<void> {
  if (!apiConfig) return;
  siteBranding.value = await fetchSiteBranding(apiConfig);
}

export async function setSiteBranding(payload: { logoUrl?: string | null; iconUrl?: string | null }): Promise<void> {
  if (!apiConfig) throw new Error('Site branding API not initialized');
  siteBranding.value = await updateSiteBranding(apiConfig, payload);
}

