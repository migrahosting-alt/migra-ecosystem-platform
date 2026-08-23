"use client";

import { useEffect, useState } from "react";
import type { AuthBrandTheme } from "@migrateck/auth-ui";

const BRANDING_SOURCE =
  process.env.NEXT_PUBLIC_AUTH_BRANDING_SOURCE ?? "hardcoded";

type Payload = Record<string, unknown>;

function asString(v: unknown, fallback?: string): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function mapPayloadToTheme(p: Payload, fallback: AuthBrandTheme): AuthBrandTheme {
  return {
    ...fallback,
    productName: asString(p.product_name, fallback.productName) ?? fallback.productName,
    logoSrc: asString(p.logo_url, fallback.logoSrc),
    monogram: asString(p.monogram, fallback.monogram) ?? fallback.monogram,
    securityLabel: asString(p.security_label, fallback.securityLabel),
    eyebrow: asString(p.eyebrow, fallback.eyebrow),
    headline: asString(p.headline, fallback.headline),
    supportCopy: asString(p.support_copy, fallback.supportCopy),
    gradientStart: asString(p.gradient_start, fallback.gradientStart) ?? fallback.gradientStart,
    gradientEnd: asString(p.gradient_end, fallback.gradientEnd) ?? fallback.gradientEnd,
    accent: asString(p.accent_color, fallback.accent) ?? fallback.accent,
    backgroundStyle:
      (asString(p.background_style, fallback.backgroundStyle) as AuthBrandTheme["backgroundStyle"]) ??
      fallback.backgroundStyle,
    supportsPhoneAuth:
      typeof p.supports_phone_auth === "boolean"
        ? p.supports_phone_auth
        : fallback.supportsPhoneAuth,
  };
}

/**
 * Step 4A: client-side registry branding behind NEXT_PUBLIC_AUTH_BRANDING_SOURCE.
 * Default ("hardcoded") -> returns the hardcoded theme unchanged, NO fetch.
 * "registry" -> fetches /clients/:clientId/branding and maps it; ANY failure
 * (no client_id, network, non-200, timeout, bad payload) keeps the hardcoded theme.
 * Never throws; never makes routing/auth decisions.
 */
export function useRegistryBrand(
  clientId: string | null | undefined,
  hardcoded: AuthBrandTheme,
): AuthBrandTheme {
  const [theme, setTheme] = useState<AuthBrandTheme>(hardcoded);

  useEffect(() => {
    setTheme(hardcoded);
    if (BRANDING_SOURCE !== "registry") return;
    if (!clientId) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    let active = true;

    fetch(`/v1/clients/${encodeURIComponent(clientId)}/branding`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: Payload | null) => {
        if (active && payload && typeof payload === "object") {
          setTheme(mapPayloadToTheme(payload, hardcoded));
        }
      })
      .catch(() => {
        /* keep hardcoded theme */
      })
      .finally(() => clearTimeout(timer));

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [clientId, hardcoded]);

  return theme;
}
