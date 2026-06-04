import { NextResponse } from "next/server";
import { getSession } from "./auth";

/**
 * Shared helpers for /api/console/* route handlers.
 *
 * All routes assume cookie-based session auth (same as the UI). If you ever
 * want machine-to-machine API tokens, add a Bearer-token check here and let it
 * fall through to the session check.
 */

export type ApiSession = {
  email: string;
};

export const requireSession = async (): Promise<
  | { ok: true; session: ApiSession }
  | { ok: false; response: NextResponse }
> => {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthenticated" },
        { status: 401, headers: { "WWW-Authenticate": "Cookie" } },
      ),
    };
  }
  return { ok: true, session: { email: session.email } };
};

export const jsonError = (status: number, error: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error, ...(extra || {}) }, { status });

export const jsonOk = <T>(body: T, init?: { status?: number }) =>
  NextResponse.json(body, init);

/** Safe JSON body parse — returns null on any error. */
export const parseJson = async <T>(req: Request): Promise<T | null> => {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
};

/** Convert a FormData-style payload from JSON body. */
export const jsonToFormData = (obj: Record<string, unknown>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "boolean") {
      // Match the HTML form convention: present + "on" = true
      if (v) fd.set(k, "on");
    } else {
      fd.set(k, String(v));
    }
  }
  return fd;
};
