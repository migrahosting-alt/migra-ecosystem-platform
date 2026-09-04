/**
 * The one way this module talks to the network: bounded, and never throwing.
 *
 * A probe that can throw turns a monitoring failure into a turn failure, which is
 * the opposite of the point. Every helper here answers `undefined` instead.
 *
 * © MigraTeck LLC.
 */

export async function getJson(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown> | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
