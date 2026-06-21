export function normalizePortalHost(host: string | null | undefined): string {
  return (String(host || "")
    .split(",")[0] || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function hostMatchesPortal(host: string, candidates: string[]): boolean {
  const normalized = normalizePortalHost(host);
  return candidates.some((candidate) => normalizePortalHost(candidate) === normalized);
}
