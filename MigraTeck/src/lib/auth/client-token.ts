export function getAccessToken(): string | null {
  return null;
}

export function setAccessToken(_token: string | null | undefined) {
  // Local access tokens are no longer used. MigraAuth-backed sessions are cookie-based.
}

export function clearAccessToken() {
  // Local access tokens are no longer used. Kept as a no-op for compatibility.
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    credentials: "include",
  });
}
