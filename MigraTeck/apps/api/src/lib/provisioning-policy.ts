export function provisioningProductAllowlist(): string[] {
  const raw = process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST?.trim();
  if (!raw) return [];

  return [
    ...new Set(
      raw
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export function provisioningProductAllowed(
  product: string | null | undefined,
): boolean {
  const allowlist = provisioningProductAllowlist();
  if (allowlist.length === 0) return true;

  const normalized = product?.trim().toUpperCase();
  return Boolean(normalized && allowlist.includes(normalized));
}

export function provisioningJobProductLane(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  for (const field of ["productLane", "product"] as const) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toUpperCase();
    }
  }

  return null;
}
