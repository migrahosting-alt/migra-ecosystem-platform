import { ProviderError } from "@/lib/vps/providers/shared/errors";

export type ProviderFetchOptions = {
  timeoutMs?: number;
  retries?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(method: string, attempt: number, retries: number, error: unknown) {
  if (attempt >= retries) {
    return false;
  }

  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  return error instanceof ProviderError && error.retryable;
}

export async function providerFetch<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ProviderFetchOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const retries = options.retries ?? 2;
  const method = (init.method || "GET").toUpperCase();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(input, {
        ...init,
        cache: "no-store",
        signal: init.signal || controller.signal,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers || {}),
        },
      });

      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        throw new ProviderError({
          code: response.status === 401 || response.status === 403
            ? "AUTH_FAILED"
            : response.status === 404
              ? "NOT_FOUND"
              : response.status === 429
                ? "RATE_LIMITED"
                : "PROVIDER_HTTP_ERROR",
          message: raw || `Provider request failed with status ${response.status}.`,
          retryable: response.status >= 500 || response.status === 429,
          status: response.status,
          raw,
        });
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json() as Promise<T>;
    } catch (error) {
      const normalizedError = error instanceof ProviderError
        ? error
        : error instanceof Error && error.name === "AbortError"
          ? new ProviderError({
            code: "TIMEOUT",
            message: "Provider request timed out.",
            retryable: true,
          })
          : new ProviderError({
            code: "NETWORK_ERROR",
            message: error instanceof Error ? error.message : "Provider network error.",
            retryable: true,
            raw: error,
          });

      if (!shouldRetry(method, attempt, retries, normalizedError)) {
        throw normalizedError;
      }

      await sleep(250 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new ProviderError({
    code: "NETWORK_ERROR",
    message: "Provider request failed after retries.",
    retryable: true,
  });
}
