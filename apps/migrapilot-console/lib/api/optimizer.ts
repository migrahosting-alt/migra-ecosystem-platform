/**
 * Shared API client for the optimizer dashboard pages.
 *
 * Fetches from the pilot-api /api/optimizer/* endpoints.
 * Falls back gracefully — each hook returns fallback data when the
 * API is unavailable.
 */

const API_BASE =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_PILOT_API_BASE ?? 'http://127.0.0.1:3377')
    : '';

export interface OptimizerApiState<T> {
  data: T;
  isLive: boolean;
  error: string | null;
}

/**
 * Generic optimizer fetch helper.
 * Returns { ok, data } or { ok: false, error }.
 */
export async function fetchOptimizer<T>(
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/optimizer${path}`);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    return { ok: true, data: (json.data ?? json) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
