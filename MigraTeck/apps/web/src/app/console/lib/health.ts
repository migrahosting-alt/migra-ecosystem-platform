/**
 * Internal service health probes.
 *
 * SCOPE — read this before adding a probe.
 *
 * This module answers exactly one question: "can app-core reach this service
 * over the internal network right now?" It is NOT public availability, and the
 * UI must never label it as such. The three concerns are deliberately separate:
 *
 *   Internal service health   app-core  → LAN/Tailscale endpoint      (this file)
 *   External availability     outside vantage point → public hostname (not built)
 *   Product health            derived from required dependencies      (ecosystem.ts)
 *
 * Why this file changed: it previously probed the estate's own public hostnames
 * (https://migrateck.com, https://panel.migrahosting.com, ...). Those resolve to
 * the edge's public IP, and app-core sits *behind* that edge with no NAT hairpin,
 * so every probe timed out — 8/8 unknown — while 7 of the 8 were fine from
 * outside. A probe that can never succeed is not an observation. Probing public
 * hostnames from inside the estate was the architectural error, so the targets
 * are now the internal upstreams the edge itself proxies to, discovered from
 * /etc/nginx/sites-enabled on nginx-proxy-core and verified reachable from
 * app-core before being written here.
 */

import { type Health, current, observed, unknown as unknownHealth } from "./fleet/health-contract";

export type ServiceHealth = {
  id: string;
  shortCode: string; // e.g. "MH"
  label: string; // "Hosting"
  /** Always null: no uptime history is stored anywhere, so no percentage can be
   *  computed. Kept on the type only because callers still read the field. */
  uptime: number | null;
  /** Canonical, evidence-bearing verdict (observedAt/expiresAt/source). Replaces
   *  the private `status` string: this was the third independent health model in
   *  the console, and three models is how semantics drift back apart. */
  health: Health;
  endpoint: string;
  lastCheckMs?: number;
};

/** How long a service probe stays current. */
const PROBE_TTL_MS = 60_000;

/** Stated on the panel so the reading is never mistaken for public uptime. */
export const INTERNAL_PROBE_SCOPE =
  "Probed from app-core over the internal network. This is reachability of the internal service, not public availability — a service that is healthy here can still be unreachable from the internet.";

type ServiceDef = {
  id: string;
  shortCode: string;
  label: string;
  /** Internal target. Empty when no distinct service exists to probe. */
  endpoint: string;
  /** Required when the target is a name-based vhost on the edge. */
  hostHeader?: string;
  /** Set when the public hostname does not correspond to its own service. */
  noDistinctService?: string;
};

const SERVICES: ServiceDef[] = [
  {
    // Deliberately still /api/health. This endpoint really does 404 on the
    // MigraTeck web app, and that discrepancy is a finding we are keeping
    // visible. Do not "fix" it by pointing the probe at the root instead —
    // either the configured probe target is wrong or the app is missing its
    // health endpoint, and that question is answered on Day 2, not hidden here.
    id: "migrateck-core",
    shortCode: "MT",
    label: "MigraTeck Core",
    endpoint: "http://127.0.0.1:3111/api/health",
  },
  {
    // migrahosting.com is a static site served by the edge itself; there is no
    // internal application behind it. Probing the edge origin with the right
    // Host header is the closest true statement we can make.
    id: "hosting",
    shortCode: "MH",
    label: "Hosting (MH)",
    endpoint: "http://10.10.0.2/",
    hostHeader: "migrahosting.com",
  },
  { id: "panel", shortCode: "MP", label: "MigraPanel (MP)", endpoint: "http://10.10.0.7:3020/health" },
  { id: "voice", shortCode: "MV", label: "Voice Services (MV)", endpoint: "http://10.10.0.10:3003/health" },
  { id: "email", shortCode: "MM", label: "Email Services (MM)", endpoint: "http://10.10.0.2:3010/api/webmail/health" },
  { id: "intake", shortCode: "MI", label: "Intake (MI)", endpoint: "http://10.10.0.10:4000/" },
  { id: "marketing", shortCode: "MK", label: "Marketing (MK)", endpoint: "http://10.10.0.10:4300/" },
  {
    // The public hostname for Automation is migrateck.com — the same web app as
    // MigraTeck Core. Probing it would report one service's health twice and
    // present it as two independent greens, which is the "tile borrowing another
    // product's health endpoint" defect. It stays unknown until a distinct
    // automation service exists to observe.
    id: "automation",
    shortCode: "AU",
    label: "Automation (AU)",
    endpoint: "",
    noDistinctService:
      "no distinct automation service is deployed — the public hostname resolves to the MigraTeck web app",
  },
];

/** Short, human-readable provenance for the row's Source column. */
const sourceLabel = (s: ServiceDef) => `internal_probe → ${s.endpoint.replace(/^https?:\/\//, "")}`;

const probeOne = async (s: ServiceDef): Promise<ServiceHealth> => {
  if (s.noDistinctService) {
    return {
      id: s.id,
      shortCode: s.shortCode,
      label: s.label,
      uptime: null,
      health: unknownHealth(s.noDistinctService, { source: "no probe target" }),
      endpoint: "—",
    };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4_000);
    const res = await fetch(s.endpoint, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      // Manual, not follow. A 301 from the edge origin is itself proof the
      // origin answered; following it would leave the internal network for the
      // public hostname and hit the same hairpin wall this file exists to avoid.
      redirect: "manual",
      ...(s.hostHeader ? { headers: { Host: s.hostHeader } } : {}),
    });
    clearTimeout(t);
    const ms = Date.now() - start;
    // Map HTTP semantics honestly. The original build used `res.status < 500`,
    // so 401 / 403 / 404 all rendered as "Operational" — a probe that finds
    // nothing at the endpoint must never show green.
    let status: "operational" | "degraded" | "down";
    if (res.status < 400) {
      // Includes 3xx: the origin responded, which is what we are measuring.
      status = "operational";
    } else if (res.status === 401 || res.status === 403) {
      // Responding and auth-gated: the service is alive, we just cannot inspect it.
      status = "operational";
    } else if (res.status >= 500) {
      status = "down";
    } else {
      // 404/410/4xx — reachable host, but not the service we expected to find.
      status = "degraded";
    }
    return {
      id: s.id,
      shortCode: s.shortCode,
      label: s.label,
      uptime: null,
      health: observed(status, {
        observedAt: new Date(),
        ttlMs: PROBE_TTL_MS,
        source: sourceLabel(s),
        latencyMs: ms,
        detail: `HTTP ${res.status}`,
      }),
      endpoint: s.endpoint,
      lastCheckMs: ms,
    };
  } catch (err) {
    // A probe failure is evidence that WE could not reach it, which is not the
    // same as evidence the service is down — the fault may be our egress, DNS
    // or a timeout. Report UNKNOWN with the error class rather than asserting
    // an outage we did not actually observe.
    const errorClass = err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.name) : "network error";
    return {
      id: s.id,
      shortCode: s.shortCode,
      label: s.label,
      uptime: null,
      health: unknownHealth(`probe: ${errorClass}`, { source: sourceLabel(s) }),
      endpoint: s.endpoint,
      lastCheckMs: Date.now() - start,
    };
  }
};

export const loadServiceHealth = async (): Promise<ServiceHealth[]> => Promise.all(SERVICES.map(probeOne));

/**
 * Summarise the probed services.
 *
 * This previously returned the literal "All Systems Operational" — a global
 * estate-wide claim derived from eight HTTP HEAD probes of public URLs. Those
 * probes say nothing about the database, the hypervisor, mail delivery, DNS or
 * the PBX, so the sentence asserted far more than the evidence supported. It
 * now reports only what was actually probed, and never hides unverified ones.
 */
export const aggregateHealth = (services: ReadonlyArray<ServiceHealth>) => {
  const states = services.map((s) => current(s.health).state);
  const total = states.length;
  const down = states.filter((x) => x === "down").length;
  const degraded = states.filter((x) => x === "degraded").length;
  const unverified = states.filter((x) => x === "unknown").length;
  const ok = states.filter((x) => x === "operational").length;

  if (total === 0) return "No services probed";
  if (down > 0) return `${down} of ${total} probed services down`;
  if (degraded > 0) return `${degraded} of ${total} probed services degraded`;
  if (unverified === total) return `${total} probed services unverified`;
  if (unverified > 0) return `${ok}/${total} probed services responding · ${unverified} unverified`;
  return `${ok}/${total} probed services responding`;
};
