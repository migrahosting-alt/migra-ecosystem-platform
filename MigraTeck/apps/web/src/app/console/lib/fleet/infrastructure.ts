import { ESTATE, type EstateNode, type Platform } from "./estate";
import type { NodeObservation, ObservationResult, LifecyclePolicy } from "./observation";

/**
 * DAY 2 — INFRASTRUCTURE: the operator model, and live read-only observation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE HOLDS NO RUNTIME STATE
 *
 * The console runs on app-core. app-core has no Proxmox credentials and must
 * never be given fleet-wide SSH — a web application that can reach every host
 * as root is a single compromise away from the whole estate. So the console
 * cannot observe guest runtime state directly. In Slice 2 it stopped guessing and
 * started asking: a GET-only, internal-token endpoint on panel-api, which owns the
 * privileged path, returns power state and role-critical service state. The
 * console renders that; it never holds the power itself.
 *
 * What this module holds is the operator model: for each node, what can be
 * observed, what could be controlled, by which mechanism, and what is actually
 * wired. Coverage is partial and says so — the control authority's key is not
 * authorised on every node, and a node we cannot reach is UNKNOWN, never "fine".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE THREE PLANES, KEPT SEPARATE
 *
 *   DECLARED    estate.ts — administrative intent. Not health.
 *   DISCOVERED  what a reconciliation run found. Dated, and goes stale.
 *   OBSERVED    a live measurement with its own timestamp, via the control authority.
 */

/** Reconciliation that produced the capability facts below. */
export const RECONCILED_AT = "2026-09-07T05:10:00Z";
export const RECONCILIATION_SOURCE =
  "qm list + pct list + qm agent ping + qm config, run on pve (pve-manager/8.4.18)";

export type ChannelState =
  /** The mechanism exists and was confirmed working at RECONCILED_AT. */
  | "available"
  /** The mechanism exists but is impaired — partial information only. */
  | "degraded"
  /** The mechanism does not exist for this node. */
  | "unavailable"
  /** The mechanism exists somewhere, but the console cannot reach it yet. */
  | "not-wired";

export interface Channel {
  state: ChannelState;
  /** How it works, or would work. Named concretely, never "TBD". */
  mechanism: string;
  /** Why it is in this state. Always populated for non-available states. */
  reason?: string;
  /** When the capability was last confirmed. Null when never confirmed. */
  verifiedAt: string | null;
}

export interface InfraNode {
  node: EstateNode;
  /** Live observation from the control authority, or null when unobserved. */
  live: NodeObservation | null;
  /** Can we learn this node's runtime state? */
  observation: Channel;
  /** Can an operator act on this node? */
  control: Channel;
  /**
   * Metrics that must NOT be rendered as utilisation for this node, with the
   * reason. Empty when the node's metrics are trustworthy.
   */
  untrustworthyMetrics: Array<{ metric: string; why: string }>;
}

/* ── observation ───────────────────────────────────────────────────────────
 * The hypervisor can always report *virtualization* state (running/stopped).
 * Reporting what is happening INSIDE a guest needs qemu-guest-agent for VMs, or
 * `pct exec` for containers. Five VMs have the agent enabled in their config but
 * the package is not installed in the guest, so `qm agent ping` gets no answer.
 * That is a real, specific, fixable gap — recorded, not hidden.
 */
const AGENT_NOT_RESPONDING = new Set(["app-core", "mail-core", "dns-core", "ns2-dns", "turn-core"]);

const observationFor = (n: EstateNode, obs: ObservationResult | null): Channel => {
  const mechanism =
    n.platform === "hypervisor"
      ? "pvesh /cluster/resources over the control authority"
      : n.platform === "lxc"
        ? "pvesh /cluster/resources + systemctl over the control authority"
        : "pvesh /cluster/resources + systemctl over the control authority";

  // Not wired at all: the console could not ask, so it knows nothing.
  if (!obs || !obs.available) {
    return {
      state: "not-wired",
      mechanism,
      reason: obs?.reason ?? "no observation channel is wired to the console",
      verifiedAt: null,
    };
  }

  const live = obs.byNodeId.get(n.nodeId) ?? null;

  if (!live) {
    return {
      state: n.lifecycleState === "TEMPLATE" || !n.lanIPv4
        ? "unavailable"
        : "not-wired",
      mechanism,
      reason:
        n.lifecycleState === "TEMPLATE"
          ? "templates carry no address and are not observation targets"
          : "this node is not an addressable control target, so it is not observed",
      verifiedAt: null,
    };
  }

  const powerKnown = live.power.state !== null;
  const servicesDeclared = live.services.observations.length > 0 || live.services.checked > 0;
  const servicesObserved = live.services.checked > 0;
  const unreachable = (live.services.reason || "").startsWith("could not reach");

  // Power is known but we cannot see inside: partial, and named as such.
  if (powerKnown && unreachable) {
    return {
      state: "degraded",
      mechanism,
      reason: `power state observed, but service state could not be: ${live.services.reason}`,
      verifiedAt: live.power.observedAt,
    };
  }
  if (powerKnown && servicesObserved) {
    return { state: "available", mechanism, verifiedAt: live.services.observedAt ?? live.power.observedAt };
  }
  if (powerKnown && !servicesDeclared) {
    return {
      state: "degraded",
      mechanism,
      reason: "power state observed; no role-critical units are declared for this node, so nothing inside it is checked",
      verifiedAt: live.power.observedAt,
    };
  }
  return {
    state: "not-wired",
    mechanism,
    reason: live.power.reason ?? "no observation returned for this node",
    verifiedAt: null,
  };
};

/* ── control ───────────────────────────────────────────────────────────────
 * A control API already exists on migrapanel-core:
 *   POST /api/admin/system-control/actions   start | stop | restart
 * It is genuinely well built — RBAC (operations.write), zod validation, an
 * approval gate, WebAuthn step-up for stop/restart, and audit events.
 *
 * It is nevertheless unusable today, for two independent reasons, and both must
 * be stated rather than smoothed over:
 *
 *   1. ZERO TARGETS — FIXED IN SLICE 2. getSystemNodes() read
 *      MIGRAPANEL_SYSTEM_NODES_JSON, falling back to MIGRAPANEL_INFRA_NODES_JSON.
 *      Neither was ever set, so the list was [] and every action resolved to
 *      node_not_found. It now reads one artifact generated from the canonical
 *      estate: 21 addressable targets.
 *
 *   2. NO POST-CONDITION VERIFICATION. The handler records result:'success' and
 *      returns status:'sent' immediately after the command returns without
 *      throwing. It never re-observes the target. A restart that leaves a
 *      service dead is recorded as a success. This is precisely the gap the
 *      paused B1 work exists to close, and it is why no button may be wired
 *      before REQUESTED → EXECUTING → VERIFYING → SUCCEEDED/FAILED exists.
 */
const controlFor = (n: EstateNode, policy: LifecyclePolicy | null): Channel => {
  const mechanism =
    "POST /internal/infrastructure/lifecycle on migrapanel-core → scoped Proxmox token " +
    "panelctl@pve!control (VM.PowerMgmt only) → independent verification via root@pam!panel-observe";

  if (n.platform === "hypervisor") {
    return {
      state: "unavailable",
      mechanism: "none — the hypervisor is not a controllable target from the console",
      reason:
        "acting on pve itself affects every guest at once; it is deliberately out of scope for operator control",
      verifiedAt: RECONCILED_AT,
    };
  }

  if (!policy || !policy.available) {
    return {
      state: "not-wired",
      mechanism,
      reason: "the console could not reach the control authority to ask what is permitted",
      verifiedAt: null,
    };
  }

  const p = n.vmid != null ? policy.byVmid.get(n.vmid) : undefined;
  if (p && p.actions.length > 0) {
    return {
      state: "available",
      mechanism,
      reason: `verified lifecycle: ${p.actions.join(", ")}`,
      verifiedAt: new Date().toISOString(),
    };
  }
  return {
    state: "not-wired",
    mechanism,
    reason: p?.blockedReason ?? "this guest is not an operable lifecycle target",
    verifiedAt: null,
  };
};

/* ── metrics that would lie ────────────────────────────────────────────────
 * Measured 2026-09-07 by comparing what Proxmox reports for a guest against
 * what the guest itself reports:
 *
 *   app-core    host 14857/16384 MB = 91%   guest 10369 MB available ≈ 35%
 *   dns-core    host  1633/2048  MB = 80%   guest  1487 MB available ≈ 25%
 *   turn-core   host  2243/4096  MB = 55%   guest  3371 MB available ≈ 14%
 *   mail-core   host  3162/4096  MB = 77%   guest  1977 MB available ≈ 50%
 *
 * Without a guest agent the host sees memory it has handed to the guest,
 * including page cache the guest counts as reclaimable. Rendering that as a
 * utilisation gauge would have put app-core — the node this console runs on —
 * at 91% and raised a false alarm. The existing panel-api fleet endpoint
 * computes memPct from exactly these host values.
 */
const untrustworthyFor = (n: EstateNode): InfraNode["untrustworthyMetrics"] => {
  if (n.platform === "vm" && AGENT_NOT_RESPONDING.has(n.nodeId)) {
    return [
      {
        metric: "Memory utilisation",
        why: "host-reported allocation, not in-guest usage — overstates by 27–56 points on this estate; needs a guest agent to measure truthfully",
      },
      {
        metric: "Filesystem usage",
        why: "Proxmox does not report disk usage for QEMU guests; a value here would have to come from inside the guest",
      },
    ];
  }
  if (n.platform === "vm") {
    return [
      {
        metric: "Filesystem usage",
        why: "Proxmox does not report disk usage for QEMU guests; must be read via the guest agent",
      },
    ];
  }
  return [];
};

export const buildInfrastructure = (
  obs: ObservationResult | null = null,
  policy: LifecyclePolicy | null = null,
): InfraNode[] =>
  ESTATE.map((node) => ({
    node,
    live: obs?.byNodeId.get(node.nodeId) ?? null,
    observation: observationFor(node, obs),
    control: controlFor(node, policy),
    untrustworthyMetrics: untrustworthyFor(node),
  }));

/** Grouping used by the page. Order is deliberate: blast radius descending. */
export const GROUPS: Array<{ key: Platform; title: string; blurb: string }> = [
  { key: "hypervisor", title: "Hypervisor", blurb: "Hosts every guest. Loss of this node is total." },
  { key: "vm", title: "Virtual machines", blurb: "Full guests. In-guest truth requires qemu-guest-agent." },
  { key: "lxc", title: "Containers", blurb: "LXC guests, introspected with pct from the hypervisor." },
];

/* ── the matrices the page renders ─────────────────────────────────────── */

export interface SourceRow {
  concern: string;
  source: string;
  plane: "DECLARED" | "DISCOVERED" | "OBSERVED";
  status: "in use" | "verified, not wired" | "exists but unusable" | "does not exist";
  note: string;
}

export const SOURCE_MATRIX: SourceRow[] = [
  {
    concern: "Node identity, role, lifecycle intent",
    source: "console lib/fleet/estate.ts",
    plane: "DECLARED",
    status: "in use",
    note: "24 nodes. Reconciled against qm list + pct list on 2026-09-07 with zero drift: no orphans in either direction.",
  },
  {
    concern: "Guest inventory and power state",
    source: "Proxmox REST /cluster/resources via panel-api (pvesh fallback)",
    plane: "OBSERVED",
    status: "in use",
    note: "RESTORED in Slice 2A. The old 401 was not a bad secret — the token object root@pam!api-token did not exist. Replaced by root@pam!panel-observe: privilege-separated, PVEAuditor on /vms, read-only (a start request returns 403). REST and pvesh were compared across all 23 guests: zero disagreements. pvesh is kept as an independent fallback, and the page names which one answered.",
  },
  {
    concern: "In-guest metrics (memory, filesystem)",
    source: "qemu-guest-agent per VM",
    plane: "OBSERVED",
    status: "exists but unusable",
    note: "7 of 12 VMs answer. 5 have the agent enabled in config but the package is not installed, so host-reported memory overstates by 27–56 points.",
  },
  {
    concern: "Service health per node",
    source: "GET /internal/infrastructure/observe (systemctl show)",
    plane: "OBSERVED",
    status: "in use",
    note: "WIRED in Slice 2, GET-only behind the internal token. Reads ActiveState/SubState/NRestarts for each node's role-critical units. Coverage is partial: the control authority's key is not authorised on every node.",
  },
  {
    concern: "Node fleet metrics",
    source: "GET /api/admin/monitoring/fleet",
    plane: "OBSERVED",
    status: "does not exist",
    note: "routes/admin-monitoring.ts was written 2026-07-05 but is never registered in index.ts. It 404s. It also filters to running && vmid < 9000, which would hide turn-core, pbs-local, and any node that is down.",
  },
  {
    concern: "Control targets",
    source: "/etc/migrapanel/control-targets.json (generated from estate.ts)",
    plane: "DECLARED",
    status: "in use",
    note: "REPLACED in Slice 2. The env registries resolved to [] and are no longer consulted. The artifact is generated from the canonical estate and carries its sha256, so a stale copy is detectable.",
  },
  {
    concern: "Privileged execution path",
    source: "migrapanel-core → pve (root ssh key)",
    plane: "DISCOVERED",
    status: "verified, not wired",
    note: "Confirmed live: migrapanel-core holds /root/.ssh/id_ed25519 and executed pveversion on pve. This stays the only privileged path; the web app never gets its own.",
  },
];

export interface ActionRow {
  action: string;
  scope: string;
  backend: string;
  guards: string;
  blocker: string;
}

/**
 * The operator action contract, defined before anything is wired.
 * Nothing here is rendered as a button in Slice 1 — a control that cannot yet
 * complete honestly must not be shown at all.
 */
export const ACTION_MATRIX: ActionRow[] = [
  {
    action: "Start",
    scope: "VM · container",
    backend: "POST /internal/infrastructure/lifecycle → panelctl@pve!control",
    guards: "estate policy · verified outcome · audit event",
    blocker: "SHIPPED in Slice 3, verified. Limited to the canary guest until the path is proven more widely.",
  },
  {
    action: "Shutdown",
    scope: "VM · container",
    backend: "POST /internal/infrastructure/lifecycle → panelctl@pve!control",
    guards: "RBAC · approval gate · WebAuthn step-up · audit",
    blocker: "SHIPPED in Slice 3, verified, with a confirmation naming the target and its impact. Canary-limited.",
  },
  {
    action: "Restart",
    scope: "VM · container",
    backend: "POST /internal/infrastructure/lifecycle → panelctl@pve!control",
    guards: "RBAC · approval gate · WebAuthn step-up · audit",
    blocker: "SHIPPED in Slice 3. Success requires a proven restart boundary (process replaced or uptime reset), not merely \"running\". Canary-limited.",
  },
  {
    action: "Start / stop / restart service",
    scope: "systemd unit on a node",
    backend: "POST /system-control/actions → ssh <node> systemctl <action> <unit>",
    guards: "RBAC · approval · step-up · unit name pattern-validated · audit",
    blocker: "Targets configured. Blocked on verification. Reachable on 6 of 10 service-bearing nodes; the rest need the control key authorised.",
  },
  {
    action: "View services",
    scope: "node",
    backend: "GET /system-control/node/:nodeId/services",
    guards: "RBAC operations.read · internal token",
    blocker: "SHIPPED read-only in Slice 2 via /internal/infrastructure/observe. Nodes the control key cannot reach render as unknown, never as 'no problems'.",
  },
  {
    action: "View logs",
    scope: "node · unit",
    backend: "GET /system-control/node/:nodeId/logs (journalctl, 10–500 lines)",
    guards: "RBAC · unit sanitised · line count clamped",
    blocker: "Endpoint exists and now has targets; not yet surfaced in the UI.",
  },
  {
    action: "Maintenance mode",
    scope: "node",
    backend: "none",
    guards: "—",
    blocker: "No backend exists. Needs design: what it suppresses and what still pages.",
  },
  {
    action: "Repair observability",
    scope: "5 VMs without a working agent",
    backend: "none",
    guards: "—",
    blocker: "Install + enable qemu-guest-agent. Candidate first write action: narrow, reversible, and independently verifiable by qm agent ping.",
  },
  {
    action: "Destroy · delete storage · delete backups · resize disk down · alter networking",
    scope: "—",
    backend: "partially present in admin-servers.ts",
    guards: "—",
    blocker: "DELIBERATELY NOT EXPOSED. Needs stronger design, permissions and recovery before an operator can reach it.",
  },
];
