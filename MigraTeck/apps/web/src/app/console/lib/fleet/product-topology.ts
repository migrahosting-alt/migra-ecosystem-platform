import "server-only";
import { nodeByAddress, type EstateNode, type Provenance } from "./estate";
import type { ServiceHealth } from "../health";
import { getReleaseInfo } from "../release";

/**
 * THE FOUR-LEVEL READ MODEL
 *
 *     PRODUCT  ≠  SERVICE INSTANCE  ≠  DEPLOYMENT  ≠  HOST / INFRASTRUCTURE
 *
 * The Ecosystem page flattened all four into one tile. A tile said "Hosting is
 * Healthy" and could not say what was probed, where it runs, or what version is
 * deployed. Three products share one host, so a single host outage would darken
 * three tiles with nothing to explain the correlation; AnnouPale has its own VM
 * that never appeared at all.
 *
 * This module composes the four levels from the authorities that already own
 * them. It introduces NO new source of truth:
 *
 *     PRODUCT          lib/ecosystem.ts     registry of products
 *     SERVICE INSTANCE lib/health.ts        what is actually probed
 *     HOST             lib/fleet/estate.ts  reconciled node identity
 *     DEPLOYMENT       lib/release.ts       release/build actually running
 *
 * ⭐ The host is DERIVED, not declared. A product-to-host table would be a
 * fourth place asserting estate identity, and it would rot silently the next
 * time an address moved. Instead the service endpoint's address is resolved
 * against the estate registry, and the answer carries the provenance of the
 * address that matched — so "which host" comes with "how do we know".
 *
 * Everything that cannot be derived is returned as null WITH A REASON. Nothing
 * here guesses, and nothing is hard-coded to make a level look populated.
 */

export interface ResolvedHost {
  nodeId: string;
  hostname: string;
  platform: EstateNode["platform"];
  vmid?: number;
  lifecycleState: EstateNode["lifecycleState"];
  environment: EstateNode["environment"];
  /** Which address matched, and how that address was learned. */
  matchedAddress: string;
  addressProvenance: Provenance;
}

export interface ResolvedServiceInstance {
  id: string;
  label: string;
  /** The probe target, or "—" when no distinct service exists to probe. */
  endpoint: string;
  host: ResolvedHost | null;
  /** Why the host is unknown, when it is. */
  hostReason?: string;
}

export interface ProductDeployment {
  release: string;
  build: string;
  builtAt: string | null;
  /** How this deployment was established. */
  source: string;
}

export interface ProductTopology {
  productId: string;
  serviceInstances: ResolvedServiceInstance[];
  /** Why there are no service instances, when there are none. */
  serviceReason?: string;
  /** Distinct hosts across this product's service instances. */
  hosts: ResolvedHost[];
  deployment: ProductDeployment | null;
  /** Why the deployment is unknown, when it is. */
  deploymentReason?: string;
}

const toResolvedHost = (
  hit: NonNullable<ReturnType<typeof nodeByAddress>>,
): ResolvedHost => ({
  nodeId: hit.node.nodeId,
  hostname: hit.node.hostname,
  platform: hit.node.platform,
  ...(hit.node.vmid === undefined ? {} : { vmid: hit.node.vmid }),
  lifecycleState: hit.node.lifecycleState,
  environment: hit.node.environment,
  matchedAddress: hit.address.value,
  addressProvenance: hit.address.provenance,
});

/** Pull the host portion out of a probe endpoint. Returns null for "—" etc. */
const addressOf = (endpoint: string): string | null => {
  if (!endpoint || endpoint === "—") return null;
  try {
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
};

const resolveHost = (endpoint: string): { host: ResolvedHost | null; reason?: string } => {
  const addr = addressOf(endpoint);
  if (!addr) return { host: null, reason: "no probe target, so no host to resolve" };

  // Loopback is a real answer, but not the one it looks like: it means the
  // service is colocated with the console. The console does not know which
  // estate node it is itself running on — there is no self-identity source —
  // so claiming a node here would be a guess. Say what is actually known.
  if (addr === "127.0.0.1" || addr === "localhost" || addr === "::1") {
    return {
      host: null,
      reason: "colocated with the console; the console has no source for its own node identity",
    };
  }

  const hit = nodeByAddress(addr);
  if (!hit) {
    return { host: null, reason: `${addr} matches no address in the reconciled estate` };
  }
  return { host: toResolvedHost(hit) };
};

/**
 * Compose the topology for one product.
 *
 * `serviceIds` comes from the product's declared dependencies; `services` is
 * the SHARED observation pass, so this never triggers a second probe and never
 * disagrees with what the tiles render.
 */
export const buildProductTopology = (
  productId: string,
  serviceIds: ReadonlyArray<string>,
  services: ReadonlyArray<ServiceHealth>,
): ProductTopology => {
  if (serviceIds.length === 0) {
    return {
      productId,
      serviceInstances: [],
      serviceReason: "no service instance is declared for this product yet",
      hosts: [],
      deployment: null,
      deploymentReason: "no deployment source exists for this product",
    };
  }

  const serviceInstances: ResolvedServiceInstance[] = serviceIds.map((id) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) {
      return {
        id,
        label: id,
        endpoint: "—",
        host: null,
        hostReason: `"${id}" is declared as a dependency but is not in the probe set`,
      };
    }
    const { host, reason } = resolveHost(svc.endpoint);
    return {
      id: svc.id,
      label: svc.label,
      endpoint: svc.endpoint,
      host,
      ...(reason ? { hostReason: reason } : {}),
    };
  });

  const hosts: ResolvedHost[] = [];
  for (const si of serviceInstances) {
    if (si.host && !hosts.some((h) => h.nodeId === si.host!.nodeId)) hosts.push(si.host);
  }

  // Deployment is only known for the product this console IS. Everything else
  // would require each product to report its own release, which is precisely
  // what a product Control API would provide and none currently does.
  const isSelf = productId === "migrateck";
  const release = isSelf ? getReleaseInfo() : null;

  return {
    productId,
    serviceInstances,
    hosts,
    deployment:
      release && release.release
        ? {
            release: release.release,
            build: release.build ?? "unknown",
            builtAt: release.builtAt,
            source: "resolved from the running process's release directory + .next/BUILD_ID",
          }
        : null,
    ...(isSelf && release?.release
      ? {}
      : { deploymentReason: "this product does not report a deployment to the console" }),
  };
};

/**
 * Hosts carrying more than one product.
 *
 * This is the correlation the flattened grid could not express: if a host goes,
 * every product on it goes with it, and the operator should be able to see that
 * before it happens rather than infer it from several tiles turning red at once.
 */
export const sharedHosts = (
  topologies: ReadonlyArray<ProductTopology>,
): Array<{ host: ResolvedHost; productIds: string[] }> => {
  const byNode = new Map<string, { host: ResolvedHost; productIds: string[] }>();
  for (const t of topologies) {
    for (const h of t.hosts) {
      const e = byNode.get(h.nodeId) ?? { host: h, productIds: [] };
      if (!e.productIds.includes(t.productId)) e.productIds.push(t.productId);
      byNode.set(h.nodeId, e);
    }
  }
  return Array.from(byNode.values()).filter((e) => e.productIds.length > 1);
};
