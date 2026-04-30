// Centralized API client — replaces all WordPress AJAX/REST calls
// Reads Bearer token from localStorage (set by auth flow)

declare const __API_BASE__: string;

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? __API_BASE__ ?? '/api';
const TOKEN_KEY = 'mb_access_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function errorMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback;
  const j = json as Record<string, unknown>;
  if (typeof j.message === 'string' && j.message.trim()) return j.message;
  return fallback;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}/v1${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const json = await parseJson(res);

  if (!res.ok) {
    throw new Error(errorMessage(json, `Request failed (${res.status})`));
  }

  return json as T;
}

// ── Sites ──────────────────────────────────────────────────────────

export interface Site {
  id: string;
  owner_id: string;
  name: string;
  domain: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function listSites(): Promise<Site[]> {
  const data = await apiFetch<{ sites: Site[] }>('/sites');
  return data.sites;
}

export async function createSite(name: string, domain?: string): Promise<Site> {
  const data = await apiFetch<{ site: Site }>('/sites', {
    method: 'POST',
    body: JSON.stringify({ name, domain }),
  });
  return data.site;
}

export async function deleteSite(siteId: string): Promise<void> {
  await apiFetch(`/sites/${siteId}`, { method: 'DELETE' });
}

// ── Pages ─────────────────────────────────────────────────────────

export interface Page {
  id: string;
  site_id: string;
  title: string;
  slug: string;
  doc_json?: unknown;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function listPages(siteId: string): Promise<Page[]> {
  const data = await apiFetch<{ pages: Page[] }>(`/sites/${siteId}/pages`);
  return data.pages;
}

export async function createPage(siteId: string, title = 'Untitled Page'): Promise<Page> {
  const data = await apiFetch<{ page: Page }>(`/sites/${siteId}/pages`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return data.page;
}

export async function getPage(siteId: string, pageId: string): Promise<Page> {
  const data = await apiFetch<{ page: Page }>(`/sites/${siteId}/pages/${pageId}`);
  return data.page;
}

export async function savePage(siteId: string, pageId: string, doc: unknown, status = 'draft'): Promise<{ success: boolean }> {
  return apiFetch(`/sites/${siteId}/pages/${pageId}/doc`, {
    method: 'POST',
    body: JSON.stringify({ doc, status }),
  });
}

export async function deletePage(siteId: string, pageId: string): Promise<void> {
  await apiFetch(`/sites/${siteId}/pages/${pageId}`, { method: 'DELETE' });
}

// ── Theme Presets ─────────────────────────────────────────────────

export interface ThemePreset {
  id: string;
  name: string;
  theme: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
}

export async function fetchPresets(scope: 'user' | 'global'): Promise<{ scope: string; presets: ThemePreset[] }> {
  return apiFetch(`/theme-presets?scope=${scope}`);
}

export async function upsertPreset(scope: 'user' | 'global', preset: ThemePreset): Promise<{ scope: string; presets: ThemePreset[] }> {
  return apiFetch('/theme-presets/upsert', {
    method: 'POST',
    body: JSON.stringify({ scope, preset }),
  });
}

export async function deletePreset(scope: 'user' | 'global', id: string): Promise<{ scope: string; presets: ThemePreset[] }> {
  return apiFetch('/theme-presets/delete', {
    method: 'POST',
    body: JSON.stringify({ scope, id }),
  });
}

export async function sharePreset(preset: ThemePreset, ttlSeconds?: number): Promise<{ shareId: string; url: string; preset: ThemePreset }> {
  return apiFetch('/theme-presets/share', {
    method: 'POST',
    body: JSON.stringify({ preset, ttlSeconds }),
  });
}

export async function fetchSharedPreset(shareId: string): Promise<{ shareId: string; preset: ThemePreset; expiresAt: number }> {
  return apiFetch(`/theme-presets/shared/${encodeURIComponent(shareId)}`);
}

export async function importPreset(shareId: string, scope: 'user' | 'global' = 'user'): Promise<{ ok: boolean; imported: ThemePreset }> {
  return apiFetch('/theme-presets/import', {
    method: 'POST',
    body: JSON.stringify({ shareId, scope }),
  });
}

// ── Site Branding ─────────────────────────────────────────────────

export interface SiteBranding {
  logoUrl: string | null;
  iconUrl: string | null;
  canManage: boolean;
}

export async function fetchSiteBranding(siteId: string): Promise<SiteBranding> {
  return apiFetch(`/sites/${siteId}/branding`);
}

export async function updateSiteBranding(siteId: string, logoUrl?: string | null, iconUrl?: string | null): Promise<SiteBranding> {
  return apiFetch(`/sites/${siteId}/branding`, {
    method: 'PATCH',
    body: JSON.stringify({ logoUrl, iconUrl }),
  });
}
