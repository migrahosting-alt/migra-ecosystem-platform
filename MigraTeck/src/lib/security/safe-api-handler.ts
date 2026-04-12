import { NextResponse } from "next/server";

/**
 * Wraps an API route handler to guarantee a sanitized JSON response.
 * Catches any unhandled throw and returns a generic 500 without leaking
 * stack traces, error messages, or implementation details.
 */
export function safeApiHandler<T extends (...args: never[]) => Promise<NextResponse>>(handler: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (err) {
      const isKnown =
        err instanceof Error &&
        "httpStatus" in err &&
        typeof (err as { httpStatus: unknown }).httpStatus === "number";

      if (isKnown) {
        const knownErr = err as Error & { httpStatus: number; code?: string };
        return NextResponse.json(
          { error: knownErr.message, ...(knownErr.code ? { code: knownErr.code } : {}) },
          { status: knownErr.httpStatus, headers: { "Cache-Control": "no-store" } },
        );
      }

      // Log for observability but never expose to client
      console.error("[API] Unhandled error:", err instanceof Error ? err.message : "unknown");

      return NextResponse.json(
        { error: "Internal server error." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  }) as T;
}
