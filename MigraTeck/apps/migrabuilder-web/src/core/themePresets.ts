import type { ThemeTokens } from './settings';
import { DEFAULT_THEME } from './settings';
import * as apiClient from '../api/client';

export type ThemePreset = {
  id: string;
  name: string;
  theme: ThemeTokens;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
};

export type PresetsEnvelope = {
  scope: 'user' | 'global';
  presets: ThemePreset[];
};

export type ShareCreateResponse = {
  shareId: string;
  url: string;
  preset: ThemePreset;
};

export type SharedPresetEnvelope = {
  shareId: string;
  preset: ThemePreset;
  expiresAt: number;
};

// Kept for API compatibility with existing callers in components
export type PresetsApiConfig = Record<string, never>;

export function coerceThemeTokens(incoming: unknown, fallback: ThemeTokens = DEFAULT_THEME): ThemeTokens {
  const t = incoming && typeof incoming === 'object' ? incoming as Record<string, unknown> : {};
  return {
    accent: String(t.accent || fallback.accent),
    accent2: String(t.accent2 || fallback.accent2),
    bg: String(t.bg || fallback.bg),
    panel: String(t.panel || fallback.panel),
    panel2: String(t.panel2 || fallback.panel2),
    text: String(t.text || fallback.text),
    muted: String(t.muted || fallback.muted),
    border: String(t.border || fallback.border),
    shadow: String(t.shadow || fallback.shadow),
    radius: Number.isFinite(Number(t.radius)) ? Number(t.radius) : fallback.radius,
  };
}

// All functions now delegate to our API client (no WordPress deps)
export async function fetchPresets(
  _api: PresetsApiConfig,
  scope: 'user' | 'global',
): Promise<PresetsEnvelope> {
  const data = await apiClient.fetchPresets(scope);
  return data as PresetsEnvelope;
}

export async function upsertPreset(
  _api: PresetsApiConfig,
  scope: 'user' | 'global',
  preset: ThemePreset,
): Promise<PresetsEnvelope> {
  const data = await apiClient.upsertPreset(scope, preset as apiClient.ThemePreset);
  return data as PresetsEnvelope;
}

export async function deletePreset(
  _api: PresetsApiConfig,
  scope: 'user' | 'global',
  id: string,
): Promise<PresetsEnvelope> {
  const data = await apiClient.deletePreset(scope, id);
  return data as PresetsEnvelope;
}

export async function sharePreset(
  _api: PresetsApiConfig,
  preset: ThemePreset,
  ttlSeconds?: number,
): Promise<ShareCreateResponse> {
  return apiClient.sharePreset(preset as apiClient.ThemePreset, ttlSeconds) as unknown as Promise<ShareCreateResponse>;
}

export async function fetchSharedPreset(_api: PresetsApiConfig, shareId: string): Promise<SharedPresetEnvelope> {
  const data = await apiClient.fetchSharedPreset(shareId);
  return data as SharedPresetEnvelope;
}
