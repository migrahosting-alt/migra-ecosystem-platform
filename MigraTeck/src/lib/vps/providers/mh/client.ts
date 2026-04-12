import { providerFetch, type ProviderFetchOptions } from "@/lib/vps/providers/shared/http";

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required provider configuration: ${name}`);
  }
  return value;
}

function mhBaseUrl(): string {
  return requireEnv("MH_API_BASE_URL", process.env.MIGRATECK_VPS_PROVIDER_BASE_URL);
}

function mhToken(): string {
  return requireEnv("MH_API_TOKEN", process.env.MIGRATECK_VPS_PROVIDER_TOKEN);
}

export function mhFetch<T>(path: string, init: RequestInit = {}, options?: ProviderFetchOptions): Promise<T> {
  return providerFetch<T>(`${mhBaseUrl()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${mhToken()}`,
      ...(init.headers || {}),
    },
  }, options);
}
