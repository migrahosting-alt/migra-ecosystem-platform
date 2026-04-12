/**
 * Auth API client for server/client components.
 */
const API_BASE = process.env["NEXT_PUBLIC_AUTH_API_URL"] ?? "http://localhost:4000";

type FetchOpts = Omit<RequestInit, "body"> & { body?: unknown };

async function authFetch<T = unknown>(
  path: string,
  opts: FetchOpts = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const { body, ...rest } = opts;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...rest.headers,
    },
    credentials: "include",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export { authFetch, API_BASE };
