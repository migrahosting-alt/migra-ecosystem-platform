function configuredPlatformOrigins(): Set<string> {
  const values = [
    process.env.APP_BASE_URL,
    process.env.MIGRATECK_LAUNCH_URL,
    "https://migrateck.com",
  ];

  const origins = new Set<string>();
  for (const value of values) {
    if (!value?.trim()) continue;
    try {
      origins.add(new URL(value.trim()).origin);
    } catch {
      // Ignore malformed optional environment values. The fixed production
      // fallback above remains available.
    }
  }
  return origins;
}

export function sanitizePlatformHostingReturn(
  raw: string | null | undefined,
): string | null {
  if (!raw?.trim()) return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.username || url.password) return null;
  if (!configuredPlatformOrigins().has(url.origin)) return null;
  if (url.pathname.replace(/\/+$/, "") !== "/platform/hosting") return null;

  const safe = new URL("/platform/hosting", url.origin);
  return safe.toString();
}

function safeHandoffOrgId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 120) return null;
  return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
}

export function buildPlatformHostingReturn(input: {
  returnTo: string | null | undefined;
  createdTenantId: string;
  handoffOrgId?: string | null;
}): string | null {
  const safeReturn = sanitizePlatformHostingReturn(input.returnTo);
  if (!safeReturn) return null;

  const tenantId = input.createdTenantId.trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(tenantId)) return null;

  const url = new URL(safeReturn);
  url.searchParams.set("handoff", "tenant_created");
  url.searchParams.set("createdTenantId", tenantId);

  const orgId = safeHandoffOrgId(input.handoffOrgId);
  if (orgId) url.searchParams.set("handoffOrgId", orgId);

  return url.toString();
}
