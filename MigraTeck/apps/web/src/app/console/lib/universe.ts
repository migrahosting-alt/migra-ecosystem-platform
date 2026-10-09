import "server-only";
import { panelQuery, isPanelDbConfigured } from "./db";
import { ESTATE, ESTATE_RECONCILED_AT, alertableNodes, nodesWithoutGuestAgent, unverifiedAddresses } from "./fleet/estate";
import { type Health, current, unknown as unknownHealth } from "./fleet/health-contract";
import type { ServiceHealth } from "./health";
import { loadCommercialClientCount } from "./modules/clients";

/**
 * Universe page data.
 *
 * Every value returned carries its own source and, where it is an observation,
 * its freshness. A count that cannot be sourced returns `null` and the UI renders
 * an honest dash — it is never replaced with 0, and never inferred.
 *
 * Deliberately excluded: any percentage without a real denominator, any trend
 * without a real series, any "uptime %" (we store no uptime history to compute
 * one from), and any estate-wide green derived from a handful of HTTP probes.
 */

export interface EstateStat {
  label: string;
  /** null means "not measured" — render as an em dash, never as 0. */
  value: number | string | null;
  source: string;
  /** Why the value is null, when it is. */
  reason?: string;
  href?: string;
}

export type AttentionSeverity = "critical" | "warning" | "unknown";

export interface AttentionItem {
  severity: AttentionSeverity;
  title: string;
  subject: string;
  detail: string;
  /** Present when the item derives from a timestamped observation. */
  observedAt?: string;
  source: string;
  href?: string;
  /** Label for the drill-in control. Names the objects it opens ("Review 5 VMs")
   *  rather than a generic verb, so the operator knows what they are about to
   *  see before they click. */
  reviewLabel?: string;
}

export interface UniverseData {
  estate: EstateStat[];
  attention: AttentionItem[];
  /** Scope statement for the attention list — what it does and does not cover. */
  attentionScope: string;
  services: ReadonlyArray<ServiceHealth>;
  estateHealth: Health;
  /** When the node registry behind the registry-sourced stats was reconciled.
   *  Shown next to them so a literal is never read as a live measurement. */
  estateReconciledAt: string;
  generatedAt: string;
}

const countOrNull = async (sql: string): Promise<number | null> => {
  if (!isPanelDbConfigured()) return null;
  const rows = await panelQuery<{ count: string }>(sql);
  const raw = rows[0]?.count;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * Estate health across the services we actually probe.
 *
 * This is NOT an estate-wide verdict: the probes cover internal HTTP reachability
 * only, and say nothing about public availability, the hypervisor, database, PBX
 * or mail delivery. The label therefore names its own scope rather than claiming
 * "all systems".
 */
const deriveEstateHealth = (services: ReadonlyArray<ServiceHealth>): Health => {
  if (services.length === 0) return unknownHealth("no services are probed");
  const states = services.map((s) => current(s.health).state);
  const unknownCount = states.filter((s) => s === "unknown").length;
  if (unknownCount === states.length) {
    return unknownHealth(`no current observation for any of ${states.length} probed services`);
  }
  // Any impairment or gap keeps the estate verdict out of "healthy". We never
  // report a positive estate state, because probe coverage is partial by design.
  return unknownHealth(
    `${states.filter((s) => s === "operational").length}/${states.length} probed services responding` +
      (unknownCount > 0 ? ` · ${unknownCount} unverified` : ""),
  );
};

/**
 * `services` is supplied by the caller, not fetched here.
 *
 * The Overview page performs exactly ONE probe pass and hands the result to
 * every panel that needs it. Previously this function probed on its own while
 * `loadEcosystem()` decided health independently, which is how the service
 * table and the product grid came to state different things about the same six
 * services in the same render. One observation, many renderings.
 */
export const loadUniverse = async (
  services: ReadonlyArray<ServiceHealth>,
): Promise<UniverseData> => {
  const [clients, staleRunCount, productCount] = await Promise.all([
    // Not a raw tenant-row count. See loadCommercialClientCount: the previous
    // query counted every active tenant row, internal and test tenants
    // included, and presented it as the client total.
    loadCommercialClientCount(),
    countOrNull(`SELECT COUNT(*)::int AS count FROM job_runs WHERE status = 'running'`),
    countOrNull(`SELECT COUNT(*)::int AS count FROM websites WHERE status = 'active'`),
  ]);

  const noAgent = nodesWithoutGuestAgent();
  const unverified = unverifiedAddresses();

  /* ── estate overview ─────────────────────────────────────────────────── */
  const estate: EstateStat[] = [
    {
      label: "Nodes",
      value: ESTATE.length,
      source: "fleet/estate.ts — reconciled against qm list + pct list",
      // Infrastructure, not Ecosystem. This counted NODES and opened the
      // PRODUCT grid — a count that navigates somewhere its own subject does
      // not appear is a broken entry point even though the link resolves.
      href: "/console/infrastructure",
    },
    {
      label: "Active nodes",
      value: alertableNodes().length,
      source: "estate lifecycleState ACTIVE/DRAINING (templates and retired excluded)",
      href: "/console/infrastructure?focus=active",
    },
    {
      label: "Probed services",
      value: services.length,
      source: "lib/health.ts internal probe list",
    },
    {
      label: "Active websites",
      value: productCount,
      source: "panel DB · websites.status = 'active'",
      ...(productCount === null ? { reason: "panel database not configured" } : {}),
      href: "/console/hosting?focus=active",
    },
    {
      label: "Clients",
      value: clients.count,
      source: clients.source,
      ...(clients.count === null ? { reason: clients.reason ?? "not measured" } : {}),
      href: "/console/clients?focus=commercial",
    },
    {
      label: "Active incidents",
      value: null,
      source: "—",
      reason: "no incident aggregation layer exists yet",
    },
  ];

  /* ── requires attention — real, provable evidence only ───────────────── */
  const attention: AttentionItem[] = [];

  for (const s of services) {
    const h = current(s.health);
    if (h.state === "down" || h.state === "degraded") {
      attention.push({
        severity: h.state === "down" ? "critical" : "warning",
        title: h.state === "down" ? "Internal service probe failed" : "Internal service degraded",
        subject: s.label,
        detail: h.detail ?? s.endpoint,
        observedAt: h.observedAt,
        source: h.source,
        href: "/console/ecosystem",
        reviewLabel: "Review product",
      });
    }
  }

  if (noAgent.length > 0) {
    attention.push({
      severity: "warning",
      title: "Observability gap",
      // Says the consequence, not the mechanism. "No qemu-guest-agent" is the
      // cause; "cannot be fully inspected" is what it costs the operator.
      subject: `${noAgent.length} VMs cannot be fully inspected`,
      detail: `${noAgent.map((n) => n.nodeId).join(", ")} — the hypervisor cannot read inside them (no qemu-guest-agent)`,
      source: "fleet/estate.ts — guestAgent: absent",
      // Opens exactly these VMs, not the whole estate. A warning naming five
      // objects must land on those five, or the operator has to find them by
      // hand and the link only looked like it worked.
      href: "/console/infrastructure?focus=no-guest-agent",
      reviewLabel: `Review ${noAgent.length} VMs`,
    });
  }

  if (staleRunCount !== null && staleRunCount > 0) {
    attention.push({
      severity: "warning",
      title: "Execution integrity",
      subject: `${staleRunCount} job runs in pre-lease running state`,
      detail: "Historical runs with no lease metadata; preserved as evidence pending reconciliation",
      source: "panel DB · job_runs.status = 'running'",
      href: "/console/automation?focus=running",
      reviewLabel: `Review ${staleRunCount} jobs`,
    });
  }

  if (unverified.length > 0) {
    attention.push({
      severity: "unknown",
      title: "Estate identity unverified",
      subject: `${unverified.length} addresses not confirmed from a running guest`,
      detail: unverified.map((u) => `${u.nodeId} ${u.address}`).slice(0, 4).join(", "),
      source: "fleet/estate.ts — provenance: unverified",
      href: "/console/infrastructure?focus=unverified-address",
      reviewLabel: `Review ${unverified.length} addresses`,
    });
  }

  const severityRank: Record<AttentionSeverity, number> = { critical: 0, warning: 1, unknown: 2 };
  attention.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    estate,
    attention,
    attentionScope:
      "Covers internal service probes, estate identity and execution-state evidence. " +
      "Does not yet cover database, hypervisor, mail delivery, DNS or PBX — no aggregation layer exists for those.",
    services,
    estateHealth: deriveEstateHealth(services),
    estateReconciledAt: ESTATE_RECONCILED_AT,
    generatedAt: new Date().toISOString(),
  };
};
