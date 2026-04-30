import type { ThemeTokens } from './settings';
import { contrastRatio, mixHex, pickBestTextOn, rgbaFromHex, relativeLuminance } from './color';

export type AutoTuneConfig = {
  enabled: boolean;
  tuneText: boolean;
  tuneSurfaces: boolean;
  tuneBorderShadow: boolean;
  surface: number; // 0.03 - 0.14
  surface2: number; // 0.05 - 0.22
  mutedBlend: number; // 0.35 - 0.75 (higher = more muted)
  borderAlpha: number; // 0.08 - 0.22
};

export const DEFAULT_AUTOTUNE: AutoTuneConfig = {
  enabled: true,
  tuneText: true,
  tuneSurfaces: true,
  tuneBorderShadow: true,
  surface: 0.08,
  surface2: 0.13,
  mutedBlend: 0.58,
  borderAlpha: 0.14,
};

function isDark(bgHex: string): boolean {
  const lum = relativeLuminance(bgHex);
  if (lum == null) return true;
  return lum < 0.35;
}

function ensureReadableText(candidate: string, bg: string): string {
  const r = contrastRatio(candidate, bg) ?? 0;
  if (r >= 4.5) return candidate;
  const alt = candidate.toUpperCase() === '#FFFFFF' ? '#000000' : '#FFFFFF';
  const ra = contrastRatio(alt, bg) ?? 0;
  return ra >= r ? alt : candidate;
}

export function autoTuneTheme(theme: ThemeTokens, cfg: AutoTuneConfig): ThemeTokens {
  const bg = theme.bg;
  const dark = isDark(bg);

  const chosenText = ensureReadableText(pickBestTextOn(bg), bg);

  const panel = mixHex(bg, chosenText, cfg.surface);
  const panel2 = mixHex(bg, chosenText, cfg.surface2);
  const muted = mixHex(chosenText, bg, cfg.mutedBlend);
  const border = rgbaFromHex(chosenText, cfg.borderAlpha);
  const shadow = dark ? 'rgba(0,0,0,0.55)' : 'rgba(10, 15, 29, 0.12)';

  return {
    ...theme,
    text: cfg.tuneText ? chosenText : theme.text,
    muted: cfg.tuneText ? muted : theme.muted,
    panel: cfg.tuneSurfaces ? panel : theme.panel,
    panel2: cfg.tuneSurfaces ? panel2 : theme.panel2,
    border: cfg.tuneBorderShadow ? border : theme.border,
    shadow: cfg.tuneBorderShadow ? shadow : theme.shadow,
  };
}

