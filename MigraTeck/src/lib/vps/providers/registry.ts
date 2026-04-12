import type { VpsProviderAdapter } from "@/lib/vps/providers/adapter";
import { mhAdapter } from "@/lib/vps/providers/mh";
import { mockVpsProviderAdapter } from "@/lib/vps/providers/mock";
import { proxmoxAdapter } from "@/lib/vps/providers/proxmox";
import { virtualizorAdapter } from "@/lib/vps/providers/virtualizor";

const registry = new Map<string, VpsProviderAdapter>([
  [mockVpsProviderAdapter.slug, mockVpsProviderAdapter],
  ["mock", mockVpsProviderAdapter],
  [mhAdapter.slug, mhAdapter],
  ["migrateck", mhAdapter],
  [proxmoxAdapter.slug, proxmoxAdapter],
  [virtualizorAdapter.slug, virtualizorAdapter],
]);

const testOverrides = new Map<string, VpsProviderAdapter>();

export function getVpsProviderAdapter(providerSlug?: string | null): VpsProviderAdapter {
  if (!providerSlug) {
    return mockVpsProviderAdapter;
  }

  return testOverrides.get(providerSlug) || registry.get(providerSlug) || mockVpsProviderAdapter;
}

export function getProvider(providerSlug?: string | null): VpsProviderAdapter {
  return getVpsProviderAdapter(providerSlug);
}

export function setVpsProviderForTests(providerSlug: string, adapter: VpsProviderAdapter | null) {
  if (adapter) {
    testOverrides.set(providerSlug, adapter);
    return;
  }

  testOverrides.delete(providerSlug);
}

export function resetVpsProvidersForTests() {
  testOverrides.clear();
}
