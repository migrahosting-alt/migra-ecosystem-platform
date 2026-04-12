const ACCESS_TOKEN_KEY = "migradrive_access_token";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string | null | undefined) {
  if (typeof window === "undefined") {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    return;
  }

  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const token = getAccessToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status !== 401) {
    return response;
  }

  const refreshResponse = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });

  if (!refreshResponse.ok) {
    clearAccessToken();
    return response;
  }

  const refreshPayload = (await refreshResponse.json().catch(() => null)) as
    | { data?: { accessToken?: string } }
    | null;
  const nextToken = refreshPayload?.data?.accessToken || null;

  if (!nextToken) {
    clearAccessToken();
    return response;
  }

  setAccessToken(nextToken);

  const retryHeaders = new Headers(init.headers || {});
  retryHeaders.set("Authorization", `Bearer ${nextToken}`);

  return fetch(input, {
    ...init,
    headers: retryHeaders,
    credentials: "include",
  });
}