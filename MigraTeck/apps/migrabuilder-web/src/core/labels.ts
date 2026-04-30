export function normalizeLabel(value: unknown): string {
  return String(value ?? '').trim();
}

export function displayTitleAndSubtitle(
  title: unknown,
  type: unknown
): { title: string; subtitle: string | null } {
  const t = normalizeLabel(title);
  const ty = normalizeLabel(type);

  const resolvedTitle = t.length ? t : ty;
  if (!resolvedTitle) return { title: '', subtitle: null };

  if (resolvedTitle.toLowerCase() === ty.toLowerCase()) return { title: resolvedTitle, subtitle: null };
  return { title: resolvedTitle, subtitle: ty || null };
}

