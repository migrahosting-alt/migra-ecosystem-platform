export type Rgb = { r: number; g: number; b: number };

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function hexToRgb(hex: string): Rgb | null {
  const v = String(hex || '').trim().replace('#', '');
  if (v.length !== 3 && v.length !== 6) return null;
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(rgb: Rgb): string {
  const to2 = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`;
}

export function mixHex(aHex: string, bHex: string, t: number): string {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  if (!a || !b) return aHex;
  const k = clamp01(t);
  return rgbToHex({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  });
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fgHex: string, bgHex: string): number | null {
  const L1 = relativeLuminance(fgHex);
  const L2 = relativeLuminance(bgHex);
  if (L1 == null || L2 == null) return null;
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function pickBestTextOn(bgHex: string): string {
  const white = '#FFFFFF';
  const black = '#000000';
  const cw = contrastRatio(white, bgHex) ?? 0;
  const cb = contrastRatio(black, bgHex) ?? 0;
  return cw >= cb ? white : black;
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  const a = clamp01(alpha);
  if (!rgb) return `rgba(255, 255, 255, ${a})`;
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})`;
}

