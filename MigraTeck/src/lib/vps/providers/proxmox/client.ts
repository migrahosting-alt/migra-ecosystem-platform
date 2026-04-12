import { providerFetch, type ProviderFetchOptions } from "@/lib/vps/providers/shared/http";

function proxmoxConfig() {
  const baseUrl = process.env.PROXMOX_API_BASE_URL;
  const tokenId = process.env.PROXMOX_API_TOKEN_ID;
  const tokenSecret = process.env.PROXMOX_API_TOKEN_SECRET;
  if (!baseUrl || !tokenId || !tokenSecret) {
    throw new Error("Missing Proxmox provider configuration.");
  }
  return { baseUrl, tokenId, tokenSecret };
}

export function proxmoxFetch<T>(path: string, init: RequestInit = {}, options?: ProviderFetchOptions) {
  const { baseUrl, tokenId, tokenSecret } = proxmoxConfig();
  return providerFetch<T>(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`,
      ...(init.headers || {}),
    },
  }, options);
}
