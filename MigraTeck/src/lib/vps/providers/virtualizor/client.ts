import { providerFetch, type ProviderFetchOptions } from "@/lib/vps/providers/shared/http";

function virtualizorConfig() {
  const baseUrl = process.env.VIRTUALIZOR_API_BASE_URL;
  const apiKey = process.env.VIRTUALIZOR_API_KEY;
  const apiPass = process.env.VIRTUALIZOR_API_PASS;
  if (!baseUrl || !apiKey || !apiPass) {
    throw new Error("Missing Virtualizor provider configuration.");
  }
  return { baseUrl, apiKey, apiPass };
}

export function virtualizorFetch<T>(path: string, init: RequestInit = {}, options?: ProviderFetchOptions) {
  const { baseUrl, apiKey, apiPass } = virtualizorConfig();
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("?")
    ? trimmedBaseUrl.endsWith("/index.php")
      ? `${trimmedBaseUrl}${path}`
      : `${trimmedBaseUrl}/index.php${path}`
    : `${trimmedBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  return providerFetch<T>(`${normalizedPath}${normalizedPath.includes("?") ? "&" : "?"}adminapikey=${encodeURIComponent(apiKey)}&adminapipass=${encodeURIComponent(apiPass)}`, init, options);
}
