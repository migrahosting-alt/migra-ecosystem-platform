export type ThemeTokens = {
  accent: string;
  accent2: string;
  bg: string;
  panel: string;
  panel2: string;
  text: string;
  muted: string;
  border: string; // rgba()
  shadow: string; // rgba()
  radius: number;
};

export type ThemeComputed = ThemeTokens & {
  border2: string; // rgba() (stronger)
  focusRing: string; // rgba(accent)
  surface: string; // panel
  surfaceHover: string;
  surfaceActive: string;
  buttonBg: string;
  buttonText: string;
  buttonBorder: string;
  tabBg: string;
  tabActiveBg: string;
  tabText: string;
  inputBg: string;
  inputText: string;
  inputBorder: string;
  inputPlaceholder: string;
};

type Rgb = { r: number; g: number; b: number };
type Oklab = { L: number; a: number; b: number };

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function clamp255(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function assertHex(hex: string): string {
  const v = String(hex ?? '').trim();
  if (!HEX_RE.test(v)) throw new Error(`Invalid hex color: ${hex}`);
  return v.toUpperCase();
}

function coerceHex(hex: unknown, fallback: string) {
  const v = String(hex ?? '').trim();
  if (!HEX_RE.test(v)) return fallback.toUpperCase();
  return v.toUpperCase();
}

function hexToRgb(hex: string): Rgb {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const to2 = (x: number) => clamp255(x).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const x = clamp01(v);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function rgbToLinearRgb(rgb: Rgb) {
  return { r: srgbToLinear(rgb.r), g: srgbToLinear(rgb.g), b: srgbToLinear(rgb.b) };
}

function linearRgbToRgb(l: { r: number; g: number; b: number }): Rgb {
  return { r: linearToSrgb(l.r) * 255, g: linearToSrgb(l.g) * 255, b: linearToSrgb(l.b) * 255 };
}

function cbrt(n: number) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return Math.cbrt ? Math.cbrt(n) : Math.pow(n, 1 / 3);
}

function linearRgbToOklab(lrgb: { r: number; g: number; b: number }): Oklab {
  const l = 0.4122214708 * lrgb.r + 0.5363325363 * lrgb.g + 0.0514459929 * lrgb.b;
  const m = 0.2119034982 * lrgb.r + 0.6806995451 * lrgb.g + 0.1073969566 * lrgb.b;
  const s = 0.0883024619 * lrgb.r + 0.2817188376 * lrgb.g + 0.6299787005 * lrgb.b;

  const l_ = cbrt(l);
  const m_ = cbrt(m);
  const s_ = cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearRgb(lab: Oklab): { r: number; g: number; b: number } {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function hexToOklab(hex: string): Oklab {
  return linearRgbToOklab(rgbToLinearRgb(hexToRgb(hex)));
}

function oklabToHex(lab: Oklab): string {
  return rgbToHex(linearRgbToRgb(oklabToLinearRgb(lab)));
}

export function relativeLuminance(hex: string): number {
  const lin = rgbToLinearRgb(hexToRgb(hex));
  return 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
}

export function contrastRatio(fg: string, bg: string): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

function mixOklab(aHex: string, bHex: string, t: number): string {
  const a = hexToOklab(aHex);
  const b = hexToOklab(bHex);
  const k = clamp01(t);
  return oklabToHex({ L: a.L + (b.L - a.L) * k, a: a.a + (b.a - a.a) * k, b: a.b + (b.b - a.b) * k });
}

function minContrastAcross(fg: string, backgrounds: string[]): number {
  let min = Infinity;
  for (const bg of backgrounds) {
    const r = contrastRatio(fg, bg);
    min = Math.min(min, r);
  }
  return min;
}

function pickBlackOrWhiteFor(backgrounds: string[]): string {
  const white = '#FFFFFF';
  const black = '#000000';
  const cw = minContrastAcross(white, backgrounds);
  const cb = minContrastAcross(black, backgrounds);
  return cw >= cb ? white : black;
}

function safeSurface(bg: string, text: string, tMax: number, minTextContrast: number): string {
  const target = mixOklab(bg, text, tMax);
  if (contrastRatio(text, target) >= minTextContrast) return target;

  let lo = 0;
  let hi = tMax;
  let best = bg;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const cand = mixOklab(bg, text, mid);
    if (contrastRatio(text, cand) >= minTextContrast) {
      best = cand;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

function ensureContrast(fgHex: string, bgHex: string, min: number): string {
  const fg = assertHex(fgHex);
  const bg = assertHex(bgHex);
  if (contrastRatio(fg, bg) >= min) return fg;

  const base = hexToOklab(fg);

  function bestWithin(rangeLo: number, rangeHi: number, wantHigherL: boolean): Oklab | null {
    let lo = rangeLo;
    let hi = rangeHi;
    let best: Oklab | null = null;

    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const candidate: Oklab = { ...base, L: mid };
      const hex = oklabToHex(candidate);
      const cr = contrastRatio(hex, bg);
      if (cr >= min) {
        best = candidate;
        if (wantHigherL) lo = mid;
        else hi = mid;
      } else {
        if (wantHigherL) hi = mid;
        else lo = mid;
      }
    }

    return best;
  }

  const baseL = clamp01(base.L);
  const darker = bestWithin(0, baseL, true); // highest L that passes (closest when darkening)
  const lighter = bestWithin(baseL, 1, false); // lowest L that passes (closest when lightening)

  if (darker && lighter) {
    return Math.abs(darker.L - baseL) <= Math.abs(lighter.L - baseL) ? oklabToHex(darker) : oklabToHex(lighter);
  }
  if (darker) return oklabToHex(darker);
  if (lighter) return oklabToHex(lighter);

  // Guaranteed fallback: pick the higher-contrast extreme.
  const cw = contrastRatio('#FFFFFF', bg);
  const cb = contrastRatio('#000000', bg);
  return cw >= cb ? '#FFFFFF' : '#000000';
}

function isDark(bgHex: string): boolean {
  return relativeLuminance(bgHex) < 0.35;
}

/**
 * Produces a high-contrast UI theme:
 * - `text`: >= 4.5:1 on bg/panels
 * - `muted`: >= 3.0:1 on bg/panels
 * - UI control backgrounds/borders derived from surfaces
 */
export function computeTheme(tokens: ThemeTokens): ThemeComputed {
  const accent = coerceHex(tokens.accent, '#5E19AE');
  const accent2 = coerceHex(tokens.accent2, '#F55144');
  const bg = coerceHex(tokens.bg, '#070A12');
  const panel = coerceHex(tokens.panel, '#0D1426');
  const panel2 = coerceHex(tokens.panel2, '#121B33');

  const radius = Number.isFinite(tokens.radius) ? Math.max(8, Math.min(28, Math.round(tokens.radius))) : 18;
  const dark = isDark(bg);

  const backgrounds = [bg, panel, panel2];
  const rawText = pickBlackOrWhiteFor(backgrounds);
  const textOnBg = ensureContrast(rawText, bg, 4.5);
  const textOnPanel = ensureContrast(textOnBg, panel, 4.5);
  const text = ensureContrast(textOnPanel, panel2, 4.5);

  const rawMuted = coerceHex(tokens.muted, dark ? '#A1A1AA' : '#64748B');
  const mutedCandidate = mixOklab(text, bg, dark ? 0.55 : 0.6);
  const mutedOnBg = ensureContrast(mutedCandidate, bg, 3.0);
  const mutedOnPanel = ensureContrast(mutedOnBg, panel, 3.0);
  const muted = ensureContrast(mutedOnPanel, panel2, 3.0);

  const border = rgba(text, dark ? 0.14 : 0.12);
  const border2 = rgba(text, dark ? 0.22 : 0.18);
  const shadow = dark ? 'rgba(0,0,0,0.55)' : 'rgba(10,15,29,0.14)';
  const focusRing = rgba(accent, 0.45);

  // UI surfaces are derived from bg+text so "grey on grey" can't happen.
  // Stored `panel/panel2` remain available as theme tokens, but the editor UI
  // consumes `--mg-*` surfaces as the source of truth.
  const surface = safeSurface(bg, text, dark ? 0.1 : 0.06, 4.5);
  const surfaceHover = safeSurface(surface, text, dark ? 0.06 : 0.04, 4.5);
  const surfaceActive = safeSurface(surface, text, dark ? 0.1 : 0.07, 4.5);

  const buttonBg = mixOklab(surface, accent, dark ? 0.3 : 0.22);
  const buttonText = ensureContrast(text, buttonBg, 4.5);
  const buttonBorder = rgba(accent, 0.35);

  const tabBg = surface;
  const tabActiveBg = mixOklab(surface, accent, dark ? 0.22 : 0.16);
  const tabText = ensureContrast(text, tabActiveBg, 4.5);

  const inputBg = mixOklab(surface, text, dark ? 0.06 : 0.03);
  const inputText = text;
  const inputBorder = border2;
  const inputPlaceholder = rgba(text, dark ? 0.45 : 0.4);

  return {
    accent,
    accent2,
    bg,
    panel,
    panel2,
    text,
    muted,
    border,
    border2,
    shadow,
    radius,
    focusRing,
    surface,
    surfaceHover,
    surfaceActive,
    buttonBg,
    buttonText,
    buttonBorder,
    tabBg,
    tabActiveBg,
    tabText,
    inputBg,
    inputText,
    inputBorder,
    inputPlaceholder,
  };
}

export function toCssVars(theme: ThemeComputed): Record<string, string> {
  return {
    '--migra-accent': theme.accent,
    '--migra-accent2': theme.accent2,
    '--migra-bg': theme.bg,
    '--migra-panel': theme.panel,
    '--migra-panel2': theme.panel2,
    '--migra-text': theme.text,
    '--migra-muted': theme.muted,
    '--migra-border': theme.border,
    '--migra-shadow': theme.shadow,
    '--migra-radius': `${theme.radius}px`,

    // Extra computed vars (used by CSS hardening)
    '--mg-border2': theme.border2,
    '--mg-focus': theme.focusRing,
    '--mg-surface': theme.surface,
    '--mg-surface-hover': theme.surfaceHover,
    '--mg-surface-active': theme.surfaceActive,
    '--mg-btn-bg': theme.buttonBg,
    '--mg-btn-text': theme.buttonText,
    '--mg-btn-border': theme.buttonBorder,
    '--mg-tab-bg': theme.tabBg,
    '--mg-tab-active-bg': theme.tabActiveBg,
    '--mg-tab-text': theme.tabText,
    '--mg-input-bg': theme.inputBg,
    '--mg-input-text': theme.inputText,
    '--mg-input-border': theme.inputBorder,
    '--mg-input-placeholder': theme.inputPlaceholder,

    // Back-compat with existing CSS helpers
    '--ring': `0 0 0 3px ${theme.focusRing}`,
    '--mg-surface-1': theme.surface,
    '--mg-surface-2': theme.surfaceHover,
    '--mg-surface-3': theme.surfaceActive,
    '--mg-line-1': theme.border,
    '--mg-line-2': theme.border2,
  };
}
