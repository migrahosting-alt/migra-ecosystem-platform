import "server-only";

const OPS_TOKEN = process.env.OPS_API_TOKEN;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const base = (process.env.PILOT_API_URL ?? "http://localhost:3399").replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(OPS_TOKEN ? { "x-ops-api-token": OPS_TOKEN } : {}),
        "content-type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: await safeText(res) };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

export async function apiPost<T>(
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  const base = (process.env.PILOT_API_URL ?? "http://localhost:3399").replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...(OPS_TOKEN ? { "x-ops-api-token": OPS_TOKEN } : {}),
        "content-type": "application/json",
      },
      body: body != null ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: await safeText(res) };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    const body = await res.json().catch(() => null);
    if (body && typeof body.error === "string") return body.error;
    return await res.text().catch(() => `HTTP ${res.status}`);
  } catch {
    return `HTTP ${res.status}`;
  }
}
