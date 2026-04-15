import type { CSSProperties } from "react";

export type ThemeMode = "light" | "dark" | "system";

export type AuthBrandTheme = {
  productKey: string;
  productName: string;
  securityLabel?: string;
  monogram: string;
  eyebrow?: string;
  headline?: string;
  supportCopy?: string;
  helperCopy?: string;
  trustBullets?: string[];
  gradientStart: string;
  gradientEnd: string;
  accent: string;
  backgroundStyle?: "soft-gradient" | "mesh" | "minimal";
};

export function toBrandStyle(theme: AuthBrandTheme): CSSProperties {
  return {
    "--brand-start": theme.gradientStart,
    "--brand-end": theme.gradientEnd,
    "--brand-accent": theme.accent,
  } as CSSProperties;
}
