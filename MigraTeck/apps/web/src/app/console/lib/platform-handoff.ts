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

const PLATFORM_TENANT_RETURN_PATHS = new Set([
  "/platform/hosting",
  "/platform/commerce/catalog",
]);

function normalizeReturnPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

export function sanitizePlatformTenantReturn(
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

  const path = normalizeReturnPath(url.pathname);
  if (!PLATFORM_TENANT_RETURN_PATHS.has(path)) return null;

  return new URL(path, url.origin).toString();
}

export function sanitizePlatformHostingReturn(
  raw: string | null | undefined,
): string | null {
  const safe = sanitizePlatformTenantReturn(raw);
  if (!safe) return null;
  return new URL(safe).pathname === "/platform/hosting" ? safe : null;
}

export function sanitizePlatformCommerceCatalogReturn(
  raw: string | null | undefined,
): string | null {
  const safe = sanitizePlatformTenantReturn(raw);
  if (!safe) return null;
  return new URL(safe).pathname === "/platform/commerce/catalog" ? safe : null;
}

function safeHandoffId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 120) return null;
  return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
}

function buildPlatformTenantReturnFromSafe(input: {
  safeReturn: string;
  createdTenantId: string;
  handoffOrgId?: string | null | undefined;
  handoffJobId?: string | null | undefined;
}): string | null {
  const tenantId = input.createdTenantId.trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(tenantId)) return null;

  const url = new URL(input.safeReturn);
  url.searchParams.set("handoff", "tenant_created");
  url.searchParams.set("createdTenantId", tenantId);

  const orgId = safeHandoffId(input.handoffOrgId);
  if (orgId) url.searchParams.set("handoffOrgId", orgId);

  const jobId = safeHandoffId(input.handoffJobId);
  if (jobId) url.searchParams.set("handoffJobId", jobId);

  return url.toString();
}

export function buildPlatformTenantReturn(input: {
  returnTo: string | null | undefined;
  createdTenantId: string;
  handoffOrgId?: string | null | undefined;
  handoffJobId?: string | null | undefined;
}): string | null {
  const safeReturn = sanitizePlatformTenantReturn(input.returnTo);
  if (!safeReturn) return null;

  return buildPlatformTenantReturnFromSafe({
    safeReturn,
    createdTenantId: input.createdTenantId,
    handoffOrgId: input.handoffOrgId,
    handoffJobId: input.handoffJobId,
  });
}

export function buildPlatformHostingReturn(input: {
  returnTo: string | null | undefined;
  createdTenantId: string;
  handoffOrgId?: string | null | undefined;
  handoffJobId?: string | null | undefined;
}): string | null {
  const safeReturn = sanitizePlatformHostingReturn(input.returnTo);
  if (!safeReturn) return null;

  return buildPlatformTenantReturnFromSafe({
    safeReturn,
    createdTenantId: input.createdTenantId,
    handoffOrgId: input.handoffOrgId,
    handoffJobId: input.handoffJobId,
  });
}
