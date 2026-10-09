/**
 * CANONICAL ESTATE — desired/configuration state only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INVARIANT THIS FILE EXISTS TO PROTECT
 *
 *   No component may claim current operational truth without fresh evidence.
 *
 * Therefore this file contains NO health, NO status, NO "online". `lifecycleState`
 * is an administrative decision about whether a node *should* exist. Whether it
 * can actually be reached is a separate runtime observation with its own
 * timestamp, produced by the observation engine and never cached here.
 *
 * The previous generation of this idea stored `status: "online"` in the `agents`
 * table. Those rows still asserted eight healthy agents 207 days after their host
 * was decommissioned. That is the failure mode this file is designed to make
 * structurally impossible.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PROVENANCE
 * Every address carries how it was learned, because during reconciliation the
 * hypervisor's own cloud-init config proved unreliable: VM 107 is declared
 * `ip=10.1.10.206` while its runtime address is 10.10.0.7 (10.1.10.x is the
 * operator's workstation LAN, not the fleet). Desired state is not evidence.
 *
 *   "discovered"  read from the running guest (qemu-guest-agent / pct exec) on
 *                 2026-09-06 — the strongest identity signal available.
 *   "declared"    read from hypervisor guest config; may be stale, see VM 107.
 *   "unverified"  inherited from documentation/ARP and NOT yet confirmed by a
 *                 running guest. Treat as a hypothesis, not a fact.
 *
 * RECONCILIATION SOURCE
 * `qm list` + `pct list` + per-guest discovery on pve (pve-manager/8.4.18),
 * 2026-09-06. Re-run scripts/reconcile-estate to refresh; drift is expected and
 * must be reconciled, not assumed away. VM 113 appeared between 2026-09-04 and
 * 2026-09-06 and was missing from the first draft of this registry.
 */

/**
 * When this registry was last reconciled against the hypervisor.
 *
 * A literal cannot go stale on its own, which is exactly the risk: every number
 * derived from ESTATE looks equally current whether it was reconciled an hour
 * ago or three months ago. Exporting the capture date lets the UI show the age
 * of registry-sourced facts, so "28 nodes" is read as "28 nodes as reconciled
 * on this date" rather than as a live measurement. Drift is expected and must
 * be reconciled, not assumed away.
 */
export const ESTATE_RECONCILED_AT = "2026-09-06";

export type Platform = "hypervisor" | "vm" | "lxc";

/* ── control eligibility ───────────────────────────────────────────────────
 * ACTIVE MUST NEVER IMPLY CONTROLLABLE.
 *
 * Lifecycle state answers "should this node exist?". It says nothing about
 * whether an operator may power-cycle it from a web page. Those are different
 * decisions with different blast radii, and conflating them is how a console
 * ends up offering Restart on a database because it happened to be running.
 *
 * Eligibility is therefore a separate, explicit, per-node administrative
 * decision. It is granted only after that node's role and dependency graph have
 * been reconciled — never because the node "looks safe".
 */
export type ControlEligibility =
  /** No lifecycle control from the console. The default for everything. */
  | "NONE"
  /** Non-production object that exists to exercise the control path. */
  | "CANARY"
  /** Reconciled, redundant or tolerably interruptible. */
  | "LOW_RISK"
  /** Important but not foundational. */
  | "PRODUCTION"
  /** Database, edge, auth, control plane, primary DNS. */
  | "CRITICAL";

export type LifecycleAction = "start" | "shutdown" | "restart";

export interface ControlPolicy {
  eligibility: ControlEligibility;
  /** Explicit per action. A tier never silently implies the full set. */
  allowedActions: LifecycleAction[];
  approvalRequired: boolean;
  stepUpRequired: boolean;
  /** Why this node has this policy. Shown to the operator. */
  reason: string;
}

/** Administrative intent. NOT health. A RETIRED node may still respond; an
 *  ACTIVE node may be down. Those are observations, decided elsewhere. */
export type LifecycleState =
  | "ACTIVE"
  | "DRAINING"
  | "RETIRED"
  | "PLANNED"
  /** Provisioning base image. Expected to be stopped; absence of a heartbeat is
   *  correct, not a fault. Kept distinct so templates never raise alerts. */
  | "TEMPLATE"
  /** Integration or migration that was started and never completed. NOT a
   *  retirement decision: the node's future role is genuinely unresolved, and
   *  saying ACTIVE would overstate it while DRAINING would presume an outcome. */
  | "TRANSITIONAL"
  /** Exists only to exercise control paths. Never carries production traffic.
   *  Distinct from ACTIVE so a test object can never be mistaken for a real one. */
  | "ACTIVE_TEST";

export type NodeRole =
  | "hypervisor"
  | "edge"
  | "app"
  | "database"
  | "mail"
  | "dns"
  | "voice"
  | "cloud"
  | "turn"
  | "backup"
  | "customer-workload"
  | "template"
  /** Non-production object whose only purpose is verifying control paths. */
  | "canary";

export type Provenance = "discovered" | "declared" | "unverified";

export interface Address {
  value: string;
  provenance: Provenance;
}

export interface EstateNode {
  /** Stable identity, independent of address. Addresses change; this does not. */
  nodeId: string;
  hostname: string;
  role: NodeRole;
  platform: Platform;
  /** Proxmox guest id. Absent for the hypervisor itself. */
  vmid?: number;
  tailscaleIPv4?: Address;
  lanIPv4?: Address;
  publicIPv4?: Address;
  environment: "production" | "infrastructure";
  lifecycleState: LifecycleState;
  /** Why a node is not ACTIVE. Required for RETIRED/DRAINING. */
  lifecycleReason?: string;
  /** True when the hypervisor cannot introspect the guest (no qemu-guest-agent).
   *  Such nodes cannot be observed via virtualization state and must be probed
   *  over the network instead — a real observability gap, recorded not hidden. */
  guestAgent?: "present" | "absent";
  /**
   * Whether this node carries production traffic. Required before any node may
   * be used as a control canary: "it looks idle" is not evidence, and a guest
   * with no observed traffic today may still be a dependency tomorrow.
   * "none" must mean reconciled-and-confirmed, not merely unobserved.
   */
  productionTraffic?: "none" | "observed";
  /** Explicit control policy. Absent means NONE — see CONTROL_POLICY below. */
  control?: ControlPolicy;
  notes?: string;
}

const d = (value: string): Address => ({ value, provenance: "discovered" });
const u = (value: string): Address => ({ value, provenance: "unverified" });

export const ESTATE: EstateNode[] = [
  /* ---------------------------------------------------------- hypervisor */
  {
    nodeId: "pve", hostname: "pve", role: "hypervisor", platform: "hypervisor",
    lanIPv4: d("10.10.0.1"), publicIPv4: d("138.201.255.55"),
    environment: "infrastructure", lifecycleState: "ACTIVE",
    notes: "pve-manager/8.4.18. Hosts every VM and LXC. Public 80/443 DNAT to VM 102. Loss of this node is total.",
  },

  /* ------------------------------------------------------- core platform */
  {
    nodeId: "nginx-proxy-core", hostname: "NGINX-PROXY-CORE", role: "edge", platform: "vm", vmid: 102,
    lanIPv4: d("10.10.0.2"), tailscaleIPv4: d("100.101.106.88"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "present",
    notes: "Public TLS edge, ~70 vhosts. Also on pod network 10.30.0.11. Single point of failure for every public site.",
  },
  {
    nodeId: "app-core", hostname: "app-core", role: "app", platform: "vm", vmid: 110,
    lanIPv4: u("10.10.0.10"), tailscaleIPv4: u("100.101.3.99"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "absent",
    notes: "Runs this Command Center (migrateck.service) and MigraGuard. NO guest agent — the hypervisor cannot introspect the host this console runs on.",
  },
  {
    nodeId: "db-core", hostname: "db-core", role: "database", platform: "vm", vmid: 106,
    lanIPv4: d("10.10.0.6"), tailscaleIPv4: d("100.77.51.91"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "present",
    notes: "Central PostgreSQL. The migrapanel role is shared across many consumers — highest blast radius in the estate.",
  },
  {
    nodeId: "migrapanel-core", hostname: "MigraPanel-Core", role: "app", platform: "vm", vmid: 107,
    lanIPv4: d("10.10.0.7"), tailscaleIPv4: d("100.68.175.27"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "present",
    notes: "panel-api (:3020), client portal, billing, provisioning worker. Holds the privileged pve ssh path — this is the control authority. Guest config still declares a stale ip=10.1.10.206.",
  },
  {
    nodeId: "mail-core", hostname: "mail-core", role: "mail", platform: "vm", vmid: 108,
    lanIPv4: u("10.10.0.8"), tailscaleIPv4: u("100.114.228.57"), publicIPv4: d("138.201.255.45"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "absent",
    notes: "Postfix, Dovecot, mailcore-api. 90 mailboxes. NO guest agent.",
  },
  {
    nodeId: "dns-core", hostname: "dns-core", role: "dns", platform: "vm", vmid: 109,
    lanIPv4: d("10.10.0.9"), tailscaleIPv4: u("100.126.11.116"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "absent",
    notes: "PowerDNS authoritative (ns1). NO guest agent.",
  },
  {
    nodeId: "ns2-dns", hostname: "ns2-dns", role: "dns", platform: "vm", vmid: 512,
    lanIPv4: d("10.10.0.11"), publicIPv4: u("138.201.255.35"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "absent",
    notes: "Secondary authoritative nameserver. Was absent from the first registry draft. NO guest agent.",
  },
  {
    nodeId: "voip-core", hostname: "VOIP-CORE", role: "voice", platform: "vm", vmid: 104,
    lanIPv4: d("10.10.0.4"), tailscaleIPv4: d("100.111.4.85"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "present",
    notes: "FreePBX / MigraVoice. The only PBX in the estate — treat every write as production.",
  },
  {
    nodeId: "cloud-core", hostname: "CLOUD-CORE", role: "cloud", platform: "vm", vmid: 103,
    lanIPv4: d("10.10.0.3"), tailscaleIPv4: d("100.113.190.42"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "present",
    notes: "CloudPods/VPS services. Hosts MinIO (migra-storage-primary) behind cloud.migrahosting.com.",
  },
  {
    nodeId: "turn-core", hostname: "turn-core", role: "turn", platform: "vm", vmid: 9001,
    tailscaleIPv4: u("100.89.188.74"), publicIPv4: d("138.201.255.24"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "absent",
    notes: "coturn for WebRTC. SSH user is ubuntu, not root. NO guest agent.",
  },

  /* ------------------------------------------------------ product estate */
  {
    nodeId: "migrapilot-app-core", hostname: "migrapilot-app-core", role: "app", platform: "vm", vmid: 111,
    lanIPv4: d("10.10.0.13"), tailscaleIPv4: d("100.95.14.29"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "present",
    notes: "MigraPilot brain backing chat.migrateck.com. Observed connecting to db-core:5432.",
  },
  {
    nodeId: "migrapilot-core", hostname: "migrapilot-core", role: "app", platform: "lxc", vmid: 101,
    lanIPv4: d("10.10.0.12"),
    environment: "production", lifecycleState: "TRANSITIONAL",
    lifecycleReason: "Unfinished MigraPilot assistant provider for the AnnouPale integration. No traffic observed.",
    productionTraffic: "none",
    notes:
      "Audited 2026-09-07. Runs pilot-web (:3399) plus ollama. POST /api/pilot/assistant answers 401, " +
      "so the provider is real — but ollama holds zero models, AnnouPale's live API process carries no " +
      "MIGRAPILOT_* environment at all, and nothing has called it since it started on 2026-07-18. " +
      "The integration was built on both sides and wired on neither. TRANSITIONAL, not RETIRED: this " +
      "records an unresolved role, not a decision to retire. Do not stop or remove without the " +
      "drain-observe-verify sequence.",
  },
  {
    nodeId: "annoupale-core", hostname: "annoupale-core", role: "app", platform: "vm", vmid: 113,
    lanIPv4: d("10.10.0.15"), tailscaleIPv4: d("100.72.225.113"),
    environment: "production", lifecycleState: "ACTIVE", guestAgent: "present",
    notes: "AnnouPale application node. Created between 2026-09-04 and 2026-09-06 — proof that a declared registry drifts and must be reconciled, not assumed.",
  },
  {
    nodeId: "pbs-local", hostname: "pbs-local", role: "backup", platform: "lxc", vmid: 9002,
    lanIPv4: d("10.10.0.50"),
    environment: "infrastructure", lifecycleState: "ACTIVE",
    notes: "Proxmox Backup Server. Was absent from the first registry draft. NOTE: backup_runs in the panel DB is EMPTY — backups may not be reporting at all.",
  },

  /* --------------------------------------------------- customer workloads */
  {
    nodeId: "pod-compassion", hostname: "pod-compassionfuneralchapel-v3", role: "customer-workload", platform: "lxc", vmid: 121,
    lanIPv4: d("10.30.0.12"), environment: "production", lifecycleState: "ACTIVE",
    notes: "compassionfuneralchapel.com. Next.js app needing a scoped pod->core firewall exception to reach Postgres.",
  },
  {
    nodeId: "pod-migrahosting-client", hostname: "pod-38f2d0c7-…-migrahosting-com", role: "customer-workload", platform: "lxc", vmid: 503,
    lanIPv4: d("10.30.0.4"), environment: "production", lifecycleState: "ACTIVE",
    notes: "Client account pod.",
  },
  {
    nodeId: "pod-elizefoundation", hostname: "pod-elizefoundation", role: "customer-workload", platform: "lxc", vmid: 504,
    lanIPv4: d("10.30.0.5"), environment: "production", lifecycleState: "ACTIVE",
    notes: "elizefoundation.org",
  },
  {
    nodeId: "pod-premtint", hostname: "pod-premtint", role: "customer-workload", platform: "lxc", vmid: 505,
    lanIPv4: d("10.30.0.6"), environment: "production", lifecycleState: "ACTIVE",
    notes: "premtint.com",
  },
  {
    nodeId: "pod-lituationdjs", hostname: "pod-lituationdjs", role: "customer-workload", platform: "lxc", vmid: 507,
    lanIPv4: d("10.30.0.8"), environment: "production", lifecycleState: "ACTIVE",
    notes: "lituationdjs.com",
  },
  {
    nodeId: "pod-yvescleaning", hostname: "pod-yvescleaningservices", role: "customer-workload", platform: "lxc", vmid: 511,
    lanIPv4: d("10.30.0.10"), environment: "production", lifecycleState: "ACTIVE",
    notes: "yvescleaningservices.com",
  },
  {
    nodeId: "pod-holisticgroupllc", hostname: "pod-holisticgroupllc", role: "customer-workload", platform: "lxc", vmid: 506,
    lanIPv4: { value: "10.30.0.7", provenance: "declared" },
    environment: "production", lifecycleState: "RETIRED",
    lifecycleReason: "Stopped intentionally by owner 2026-07-03. Being stopped is CORRECT for this node; it must never raise an availability alert.",
  },

  /* ----------------------------------------------------------- templates */
  {
    nodeId: "cloudpod-template", hostname: "cloudpod-template", role: "template", platform: "lxc", vmid: 9000,
    environment: "infrastructure", lifecycleState: "TEMPLATE",
    lifecycleReason: "Base provisioning image. Expected to be stopped.",
  },
  {
    nodeId: "cloudpod-wp-base", hostname: "cloudpod-wp-base", role: "template", platform: "lxc", vmid: 9504,
    lanIPv4: { value: "10.30.0.94", provenance: "declared" },
    environment: "infrastructure", lifecycleState: "TEMPLATE",
    lifecycleReason: "Active CLOUDPOD_TEMPLATE_VMID for WordPress provisioning. Expected to be stopped.",
  },
  /* ------------------------------------------------------- control canary */
  {
    // Deliberately boring. Created 2026-09-07 solely to answer "does MigraPanel
    // lifecycle control work correctly?" without also asking "and did we just
    // interrupt backups or DNS?". No network interface at all, so it cannot
    // carry traffic even by accident. onboot=0, so it stays inert unless a test
    // starts it.
    nodeId: "migrapanel-control-canary", hostname: "migrapanel-control-canary",
    role: "canary", platform: "lxc", vmid: 9999,
    environment: "infrastructure", lifecycleState: "ACTIVE_TEST",
    productionTraffic: "none",
    notes:
      "Lifecycle verification canary. NOT PRODUCTION. No network interface, no persistent data, no " +
      "dependencies, no DNS, no reverse-proxy route. Safe to start, stop, restart or destroy at any time.",
  },
];

/** Nodes an availability alert may legitimately fire for. Templates and retired
 *  nodes are excluded by intent, so 'stopped' is never reported as a fault. */
/* ── the control policy table ──────────────────────────────────────────────
 * Explicit entries only. ANYTHING NOT LISTED HERE IS "NONE" — control is opt-in,
 * per node, per action, and must be earned by a passed dependency preflight.
 *
 * Promotion history and refusals are recorded here rather than in a ticket, so
 * the reason a node is (or is not) controllable travels with the estate model.
 */
const CONTROL_POLICY: Record<string, ControlPolicy> = {
  "migrapanel-control-canary": {
    eligibility: "CANARY",
    allowedActions: ["start", "shutdown", "restart"],
    approvalRequired: false,
    stepUpRequired: false,
    reason:
      "Tier 0. Purpose-built, non-production, no traffic, no data, no dependencies. Exists to exercise the control path.",
  },

  /* ── considered and REFUSED ──────────────────────────────────────────────
   * ns2-dns was the proposed Tier 1 candidate. Preflight 2026-09-07 refused it:
   * both public NS IPs answer via dnsmasq with recursion and no `aa` bit, and
   * `ns2.migrahosting.com` (138.201.255.35) is bound on the hypervisor's vmbr0
   * with NO port-53 DNAT to this guest — the authoritative path is a different
   * address entirely (138.201.255.46 → 10.10.0.9 dns-core). So what this guest
   * actually serves is unknown, and an unknown dependency graph cannot be
   * promoted. Recorded rather than silently skipped. */
  "ns2-dns": {
    eligibility: "NONE",
    allowedActions: [],
    approvalRequired: true,
    stepUpRequired: true,
    reason:
      "Role not reconciled: the ns2 delegation address is not routed to this guest, so the effect of restarting it cannot be predicted.",
  },
};

/** Default deny. Control is opt-in and never inferred from lifecycle state. */
export const controlPolicyFor = (node: EstateNode): ControlPolicy =>
  node.control ??
  CONTROL_POLICY[node.nodeId] ?? {
    eligibility: "NONE",
    allowedActions: [],
    approvalRequired: true,
    stepUpRequired: true,
    reason: "Not yet promoted for console lifecycle control.",
  };

export const alertableNodes = () =>
  ESTATE.filter((n) => n.lifecycleState === "ACTIVE" || n.lifecycleState === "DRAINING");

/** Nodes the hypervisor cannot introspect — a recorded observability gap. */
export const nodesWithoutGuestAgent = () =>
  ESTATE.filter((n) => n.platform === "vm" && n.guestAgent === "absent");

/** Identity the estate has not yet proven from a running guest. */
export const unverifiedAddresses = () =>
  ESTATE.flatMap((n) =>
    [n.tailscaleIPv4, n.lanIPv4, n.publicIPv4]
      .filter((a): a is Address => Boolean(a) && a!.provenance === "unverified")
      .map((a) => ({ nodeId: n.nodeId, address: a.value })),
  );

export const estateNode = (nodeId: string) => ESTATE.find((n) => n.nodeId === nodeId);

/**
 * Resolve an IP address to the node that carries it.
 *
 * This is what lets the console derive "which host is this service on?" from a
 * probe endpoint instead of hardcoding a product-to-host table. A hardcoded map
 * would be a fourth place where estate identity is asserted, and it would go
 * stale silently the next time an address moves — exactly what the provenance
 * field on Address exists to prevent.
 *
 * Returns the matching node AND which address matched, so the caller can tell
 * the operator how confident that identification is: an address learned from a
 * running guest ("discovered") is stronger evidence than one inherited from
 * documentation ("unverified").
 */
export const nodeByAddress = (
  ip: string,
): { node: EstateNode; matchedOn: keyof Pick<EstateNode, "tailscaleIPv4" | "lanIPv4" | "publicIPv4">; address: Address } | null => {
  for (const node of ESTATE) {
    for (const key of ["tailscaleIPv4", "lanIPv4", "publicIPv4"] as const) {
      const a = node[key];
      if (a && a.value === ip) return { node, matchedOn: key, address: a };
    }
  }
  return null;
};
