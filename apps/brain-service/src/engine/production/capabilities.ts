// Operational Readiness Slice 5 — read-only diagnostic capability implementations.
//
// Each capability is READ-ONLY: it reads a signal through the Prober (or the
// registry's approved endpoints) and returns evidence. None mutate. Status is
// derived from evidence — never "healthy" merely because a connection opened.
//
// © MigraTeck LLC.

import type { DiagnosticResult, DiagnosticStatus } from './types.js';
import type { CapabilityRunContext, DiagnosticCapability } from './provider.js';
import type { ApprovedEndpoint, ProductionTarget } from './targetRegistry.js';

function endpointOf(ctx: CapabilityRunContext): ApprovedEndpoint | undefined {
  if (ctx.params.endpointId) return ctx.registry.endpoint(ctx.target, ctx.params.endpointId);
  return ctx.target.approvedEndpoints[0];
}

function unknownResult(what: string): DiagnosticResult {
  return {
    status: 'unknown',
    observations: [`No conclusive read-only signal for ${what}.`],
    evidence: {},
    interpretation: `${what} could not be determined from the available read-only diagnostics.`,
    limitations: ['Read-only diagnostics reader returned no usable signal.'],
    recommendedNextSteps: [],
  };
}

/** Service & process health (read-only). */
const serviceHealth: DiagnosticCapability = {
  id: 'production.diagnostics.serviceHealth',
  description: 'Read-only service/process health: state, uptime, restarts, version, dependency reachability.',
  async run(ctx): Promise<DiagnosticResult> {
    const s = await ctx.prober.serviceStatus(ctx.target, endpointOf(ctx));
    const observations: string[] = [];
    const evidence: Record<string, string | number | boolean> = {};
    const limitations: string[] = [];
    const nextSteps: string[] = [];

    if (!s.exists) {
      return {
        status: 'unhealthy',
        observations: ['Expected service was not found on the target.'],
        evidence: { exists: false },
        interpretation: 'The expected service does not exist or is not visible to the read-only probe.',
        limitations: ['Read-only probe cannot distinguish "removed" from "not visible with diagnostics credentials".'],
        recommendedNextSteps: ['Confirm the service name and that the diagnostics reader can observe it.'],
      };
    }
    evidence.exists = true;
    if (s.state) { evidence.state = s.state; observations.push(`Service state is ${s.state}.`); }
    if (typeof s.uptimeSec === 'number') evidence.uptimeSec = s.uptimeSec;
    if (typeof s.restartCount === 'number') { evidence.restartCount = s.restartCount; if (s.restartCount > 0) observations.push(`Restart count is ${s.restartCount}.`); }
    if (s.versionId) evidence.versionId = s.versionId;
    if (typeof s.dependencyReachable === 'boolean') { evidence.dependencyReachable = s.dependencyReachable; observations.push(s.dependencyReachable ? 'Dependencies reachable.' : 'A dependency is unreachable.'); }

    let status: DiagnosticStatus = 'unknown';
    let interpretation = 'Service state could not be conclusively determined from read-only signals.';
    if (s.state === 'crashed' || s.state === 'stopped') {
      status = 'unhealthy';
      interpretation = 'Service is not running.';
      nextSteps.push('Review service logs and recent deploys via read-only diagnostics.');
    } else if (s.state === 'restarting' || (s.restartCount ?? 0) >= 3 || s.dependencyReachable === false) {
      status = 'degraded';
      interpretation = 'Service is reachable but shows instability (restarts or dependency issue).';
      nextSteps.push('Inspect restart cause and dependency health.');
    } else if (s.state === 'running') {
      status = 'healthy';
      interpretation = 'Service is running and dependencies are reachable.';
    } else {
      limitations.push('State signal was inconclusive under the read-only probe.');
    }
    return { status, observations, evidence, interpretation, limitations, recommendedNextSteps: nextSteps };
  },
};

/** Logs (read-only, bounded window + line count, approved services only). */
const logs: DiagnosticCapability = {
  id: 'production.diagnostics.logs',
  description: 'Read-only bounded log window for an approved service (redacted).',
  async run(ctx): Promise<DiagnosticResult> {
    const lines = await ctx.prober.readLogs(ctx.target, { windowMinutes: ctx.params.windowMinutes, maxLines: ctx.params.maxLines });
    const capped = lines.slice(0, ctx.params.maxLines);
    const errorMarkers = capped.filter((l) => /\b(error|exception|fatal|panic|traceback)\b/i.test(l)).length;
    // Lines are surfaced as observations; the provider redacts every string before
    // transport + persistence (defense-in-depth over the reader).
    const status: DiagnosticStatus = capped.length === 0 ? 'unknown' : errorMarkers > 0 ? 'degraded' : 'healthy';
    return {
      status,
      observations: capped,
      evidence: { lineCount: capped.length, windowMinutes: ctx.params.windowMinutes, errorMarkers },
      interpretation:
        capped.length === 0
          ? 'No log lines were returned in the requested window.'
          : errorMarkers > 0
            ? `Log window contains ${errorMarkers} error/exception marker(s).`
            : 'Log window shows no error markers.',
      limitations: ['Bounded window + line cap; not a full log search. No arbitrary grep or path access.'],
      recommendedNextSteps: errorMarkers > 0 ? ['Widen the window (still bounded) and review the flagged lines.'] : [],
    };
  },
};

/** Metrics (read-only, bounded). */
const metrics: DiagnosticCapability = {
  id: 'production.diagnostics.metrics',
  description: 'Read-only resource metrics: cpu/memory/disk/load/network.',
  async run(ctx): Promise<DiagnosticResult> {
    const m = await ctx.prober.readMetrics(ctx.target);
    const evidence: Record<string, number | boolean> = {};
    if (typeof m.cpuPercent === 'number') evidence.cpuPercent = m.cpuPercent;
    if (typeof m.memoryPercent === 'number') evidence.memoryPercent = m.memoryPercent;
    if (typeof m.diskPercent === 'number') evidence.diskPercent = m.diskPercent;
    if (typeof m.load1 === 'number') evidence.load1 = m.load1;
    if (typeof m.networkOk === 'boolean') evidence.networkOk = m.networkOk;
    if (Object.keys(evidence).length === 0) return unknownResult('resource metrics');

    const observations: string[] = [];
    let status: DiagnosticStatus = 'healthy';
    const worse = (s: DiagnosticStatus) => { if (rank(s) > rank(status)) status = s; };
    if ((m.diskPercent ?? 0) >= 95) { worse('unhealthy'); observations.push(`Disk at ${m.diskPercent}%.`); }
    else if ((m.diskPercent ?? 0) >= 85) { worse('degraded'); observations.push(`Disk at ${m.diskPercent}%.`); }
    if ((m.cpuPercent ?? 0) >= 95 || (m.memoryPercent ?? 0) >= 95) { worse('degraded'); observations.push('CPU/memory pressure is high.'); }
    if (m.networkOk === false) { worse('degraded'); observations.push('Network health signal is negative.'); }
    return {
      status,
      observations,
      evidence,
      interpretation: status === 'healthy' ? 'Resource metrics are within normal thresholds.' : 'One or more resource metrics indicate pressure.',
      limitations: ['Point-in-time snapshot; not a trend.'],
      recommendedNextSteps: status === 'healthy' ? [] : ['Review capacity/scaling via the appropriate change-managed workflow (not via diagnostics).'],
    };
  },
};

/** Database (read-only: connectivity, version, saturation, replication, migration
 * state, predefined safe metadata only — NO arbitrary SQL, ever). */
const database: DiagnosticCapability = {
  id: 'production.diagnostics.database',
  description: 'Read-only database health: connectivity, version, connections, replication, migration state.',
  async run(ctx): Promise<DiagnosticResult> {
    const d = await ctx.prober.databaseHealth(ctx.target);
    if (!d.reachable) {
      return {
        status: 'unreachable',
        observations: ['Database did not answer the read-only connectivity check.'],
        evidence: { reachable: false },
        interpretation: 'The database is unreachable with the diagnostics reader credentials.',
        limitations: ['Connectivity only; no data access is attempted.'],
        recommendedNextSteps: ['Verify network path and that the read-only diagnostics account is valid.'],
      };
    }
    const evidence: Record<string, string | number | boolean> = { reachable: true };
    if (d.serverVersion) evidence.serverVersion = d.serverVersion;
    if (typeof d.connectionsUsed === 'number') evidence.connectionsUsed = d.connectionsUsed;
    if (typeof d.connectionsMax === 'number') evidence.connectionsMax = d.connectionsMax;
    if (typeof d.replicationHealthy === 'boolean') evidence.replicationHealthy = d.replicationHealthy;
    if (d.migrationState) evidence.migrationState = d.migrationState;

    const observations: string[] = [];
    let status: DiagnosticStatus = 'healthy';
    const worse = (s: DiagnosticStatus) => { if (rank(s) > rank(status)) status = s; };
    const saturation = d.connectionsMax ? (d.connectionsUsed ?? 0) / d.connectionsMax : 0;
    if (saturation >= 0.9) { worse('degraded'); observations.push(`Connection pool ${Math.round(saturation * 100)}% saturated.`); }
    if (d.replicationHealthy === false) { worse('degraded'); observations.push('Replication is unhealthy.'); }
    if (d.migrationState && d.migrationState !== 'applied') { worse('degraded'); observations.push(`Migration state is ${d.migrationState}.`); }
    return {
      status,
      observations,
      evidence,
      interpretation: status === 'healthy' ? 'Database is reachable and health metadata is nominal.' : 'Database is reachable but a health metadata signal is degraded.',
      limitations: ['Predefined safe metadata queries only — no arbitrary SQL, DDL, locks, or row access.'],
      recommendedNextSteps: status === 'healthy' ? [] : ['Review the flagged database health signal.'],
    };
  },
};

/** DNS (read-only authoritative resolution + expected-record comparison). */
const dns: DiagnosticCapability = {
  id: 'production.diagnostics.dns',
  description: 'Read-only DNS resolution and expected-record comparison.',
  async run(ctx): Promise<DiagnosticResult> {
    const endpoint = endpointOf(ctx);
    if (!endpoint) return unknownResult('DNS (no approved endpoint selected)');
    const r = await ctx.prober.resolveDns(endpoint);
    if (!r.reachable) {
      return {
        status: 'unreachable',
        observations: ['DNS resolution failed.'],
        evidence: { reachable: false, ...(r.protocolError ? { protocolError: r.protocolError } : {}) },
        interpretation: 'The authoritative DNS query did not succeed.',
        limitations: ['Resolution only; no DNS records are modified.'],
        recommendedNextSteps: ['Verify the zone and resolver path.'],
      };
    }
    const status: DiagnosticStatus = r.matchesExpected === false ? 'degraded' : r.matchesExpected === true ? 'healthy' : 'unknown';
    return {
      status,
      observations: [`Resolved ${r.records.length} record(s).`, ...(r.matchesExpected === false ? ['Resolved records differ from the expected set.'] : [])],
      evidence: { reachable: true, recordCount: r.records.length, ...(r.matchesExpected !== undefined ? { matchesExpected: r.matchesExpected } : {}) },
      interpretation: r.matchesExpected === false ? 'DNS resolves but does not match the expected records.' : r.matchesExpected === true ? 'DNS resolves and matches the expected records.' : 'DNS resolves; no expected-record baseline configured.',
      limitations: ['Read-only resolution + comparison; no record changes.'],
      recommendedNextSteps: r.matchesExpected === false ? ['Review the expected-record baseline vs current zone.'] : [],
    };
  },
};

/** TLS (read-only certificate + chain + validity inspection). */
const tls: DiagnosticCapability = {
  id: 'production.diagnostics.tls',
  description: 'Read-only TLS certificate inspection: chain, hostname, validity, renewal risk.',
  async run(ctx): Promise<DiagnosticResult> {
    const endpoint = endpointOf(ctx);
    if (!endpoint) return unknownResult('TLS (no approved endpoint selected)');
    const r = await ctx.prober.inspectTls(endpoint);
    if (!r.reachable) {
      return {
        status: 'unreachable',
        observations: ['TLS endpoint did not complete a handshake.'],
        evidence: { reachable: false, ...(r.protocolError ? { protocolError: r.protocolError } : {}) },
        interpretation: 'The TLS endpoint is unreachable or refused the handshake.',
        limitations: ['Handshake inspection only; no certificate is issued or replaced.'],
        recommendedNextSteps: ['Verify the endpoint and TLS listener.'],
      };
    }
    const evidence: Record<string, string | number | boolean> = { reachable: true };
    if (typeof r.daysToExpiry === 'number') evidence.daysToExpiry = r.daysToExpiry;
    if (typeof r.hostnameMatch === 'boolean') evidence.hostnameMatch = r.hostnameMatch;
    if (typeof r.chainValid === 'boolean') evidence.chainValid = r.chainValid;

    let status: DiagnosticStatus = 'healthy';
    const observations: string[] = [];
    const nextSteps: string[] = [];
    if (r.chainValid === false || r.hostnameMatch === false || (r.daysToExpiry ?? 999) <= 0) {
      status = 'unhealthy';
      observations.push('Certificate is invalid, mismatched, or expired.');
      nextSteps.push('Review the certificate renewal workflow.');
    } else if ((r.daysToExpiry ?? 999) < 14) {
      status = 'degraded';
      observations.push(`Certificate expires in ${r.daysToExpiry} day(s).`);
      nextSteps.push('Review the certificate renewal workflow.');
    } else {
      observations.push('Certificate chain valid and not near expiry.');
    }
    return {
      status,
      observations,
      evidence,
      interpretation: status === 'healthy' ? 'TLS certificate is valid and not near expiry.' : status === 'degraded' ? 'TLS is currently valid but renewal risk is elevated.' : 'TLS certificate has a validity problem.',
      limitations: ['Inspection only; no certificate is renewed or replaced by diagnostics.'],
      recommendedNextSteps: nextSteps,
    };
  },
};

/** HTTP (read-only health probe of an APPROVED url only — SSRF-safe). */
const http: DiagnosticCapability = {
  id: 'production.diagnostics.http',
  description: 'Read-only HTTP health probe of an approved endpoint (status, latency, safe headers).',
  async run(ctx): Promise<DiagnosticResult> {
    const endpoint = endpointOf(ctx);
    if (!endpoint || !endpoint.url) return unknownResult('HTTP (no approved URL endpoint selected)');
    const r = await ctx.prober.httpProbe(endpoint);
    if (!r.reachable) {
      return {
        status: 'unreachable',
        observations: ['HTTP endpoint did not respond.'],
        evidence: { reachable: false },
        interpretation: 'The approved HTTP endpoint is unreachable.',
        limitations: ['Approved endpoint only; arbitrary URLs cannot be probed.'],
        recommendedNextSteps: ['Verify the service and ingress path.'],
      };
    }
    const evidence: Record<string, string | number | boolean> = { reachable: true };
    if (typeof r.status === 'number') evidence.httpStatus = r.status;
    if (typeof r.latencyMs === 'number') evidence.latencyMs = r.latencyMs;
    if (typeof r.redirects === 'number') evidence.redirects = r.redirects;

    let status: DiagnosticStatus = 'healthy';
    const observations: string[] = [`HTTP ${r.status ?? '?'} in ${r.latencyMs ?? '?'}ms.`];
    if ((r.status ?? 0) >= 500) status = 'unhealthy';
    else if ((r.status ?? 0) >= 400 || (r.latencyMs ?? 0) > 3000) status = 'degraded';
    return {
      status,
      observations,
      evidence,
      interpretation: status === 'healthy' ? 'Endpoint responds successfully with acceptable latency.' : status === 'degraded' ? 'Endpoint reachable but returned a client error or elevated latency.' : 'Endpoint returned a server error.',
      limitations: ['Approved endpoint only; bounded redirects; SSRF and arbitrary-URL probing are prevented by the target registry.'],
      recommendedNextSteps: status === 'healthy' ? [] : ['Correlate with service health and logs.'],
    };
  },
};

/** Mail (read-only / synthetic-safe; sends NO email). */
const mail: DiagnosticCapability = {
  id: 'production.diagnostics.mail',
  description: 'Read-only mail diagnostics: reachability, DNS, TLS, queue aggregate, auth config presence.',
  async run(ctx): Promise<DiagnosticResult> {
    const m = await ctx.prober.mailHealth(ctx.target, endpointOf(ctx));
    if (!m.reachable) return { status: 'unreachable', observations: ['Mail service did not answer the read-only check.'], evidence: { reachable: false }, interpretation: 'Mail service unreachable.', limitations: ['No email is sent in this diagnostic.'], recommendedNextSteps: ['Verify mail host reachability.'] };
    const evidence: Record<string, string | number | boolean> = { reachable: true };
    if (typeof m.dnsOk === 'boolean') evidence.dnsOk = m.dnsOk;
    if (typeof m.tlsOk === 'boolean') evidence.tlsOk = m.tlsOk;
    if (typeof m.queueDepth === 'number') evidence.queueDepth = m.queueDepth;
    if (typeof m.authConfigured === 'boolean') evidence.authConfigured = m.authConfigured;

    const observations: string[] = [];
    let status: DiagnosticStatus = 'healthy';
    const worse = (s: DiagnosticStatus) => { if (rank(s) > rank(status)) status = s; };
    if (m.dnsOk === false) { worse('degraded'); observations.push('Mail DNS records are incomplete.'); }
    if (m.tlsOk === false) { worse('degraded'); observations.push('Mail TLS negotiation failed.'); }
    if ((m.queueDepth ?? 0) > 100) { worse('degraded'); observations.push(`Mail queue depth is ${m.queueDepth}.`); }
    if (m.authConfigured === false) { worse('degraded'); observations.push('SPF/DKIM auth configuration appears absent.'); }
    return {
      status,
      observations,
      evidence,
      interpretation: status === 'healthy' ? 'Mail service reachable with nominal DNS/TLS/queue/auth signals.' : 'Mail service reachable but a health signal is degraded.',
      limitations: ['Read-only / synthetic-safe only. No production email is sent. Auth PRESENCE only — never secret values.'],
      recommendedNextSteps: status === 'healthy' ? [] : ['Review the flagged mail signal.'],
    };
  },
};

/** Storage (read-only: reachability, capacity, latency, replication). No writes. */
const storage: DiagnosticCapability = {
  id: 'production.diagnostics.storage',
  description: 'Read-only storage diagnostics: reachability, capacity, latency, replication health.',
  async run(ctx): Promise<DiagnosticResult> {
    const s = await ctx.prober.storageHealth(ctx.target, endpointOf(ctx));
    if (!s.reachable) return { status: 'unreachable', observations: ['Storage endpoint did not answer.'], evidence: { reachable: false }, interpretation: 'Storage unreachable.', limitations: ['No object is created, modified, or deleted.'], recommendedNextSteps: ['Verify storage endpoint reachability.'] };
    const evidence: Record<string, string | number | boolean> = { reachable: true };
    if (typeof s.capacityPercent === 'number') evidence.capacityPercent = s.capacityPercent;
    if (typeof s.latencyMs === 'number') evidence.latencyMs = s.latencyMs;
    if (typeof s.replicationHealthy === 'boolean') evidence.replicationHealthy = s.replicationHealthy;

    const observations: string[] = [];
    let status: DiagnosticStatus = 'healthy';
    const worse = (st: DiagnosticStatus) => { if (rank(st) > rank(status)) status = st; };
    if ((s.capacityPercent ?? 0) >= 95) { worse('unhealthy'); observations.push(`Storage at ${s.capacityPercent}% capacity.`); }
    else if ((s.capacityPercent ?? 0) >= 85) { worse('degraded'); observations.push(`Storage at ${s.capacityPercent}% capacity.`); }
    if (s.replicationHealthy === false) { worse('degraded'); observations.push('Storage replication is unhealthy.'); }
    return {
      status,
      observations,
      evidence,
      interpretation: status === 'healthy' ? 'Storage reachable with nominal capacity and replication.' : 'Storage reachable but capacity or replication is degraded.',
      limitations: ['Read-only. No object creation, deletion, or modification.'],
      recommendedNextSteps: status === 'healthy' ? [] : ['Review storage capacity/replication via a change-managed workflow.'],
    };
  },
};

const RANK: Record<DiagnosticStatus, number> = { healthy: 0, unknown: 1, degraded: 2, unreachable: 3, unauthorized: 3, unhealthy: 4 };
function rank(s: DiagnosticStatus): number {
  return RANK[s];
}

/** Summary — aggregates every OTHER approved capability for the target and rolls
 * up the worst status. Runs the read-only capabilities directly (aggregation, not
 * a new authorized dispatch); adds no mutation. */
function makeSummary(domain: DiagnosticCapability[]): DiagnosticCapability {
  const byId = new Map(domain.map((c) => [c.id, c]));
  return {
    id: 'production.diagnostics.summary',
    description: 'Read-only rollup of the target’s approved diagnostic capabilities.',
    async run(ctx): Promise<DiagnosticResult> {
      const ids = ctx.target.approvedCapabilities.filter((id) => id !== 'production.diagnostics.summary' && byId.has(id));
      const evidence: Record<string, string | number | boolean> = { capabilitiesRun: ids.length };
      const observations: string[] = [];
      let status: DiagnosticStatus = ids.length === 0 ? 'unknown' : 'healthy';
      for (const id of ids) {
        const r = await byId.get(id)!.run(ctx);
        evidence[id.replace('production.diagnostics.', '')] = r.status;
        observations.push(`${id.replace('production.diagnostics.', '')}: ${r.status}`);
        if (rank(r.status) > rank(status)) status = r.status;
      }
      return {
        status,
        observations,
        evidence,
        interpretation: ids.length === 0 ? 'No sub-capabilities are approved for this target.' : `Overall status is the worst of ${ids.length} read-only check(s): ${status}.`,
        limitations: ['Aggregate of read-only checks; advisory only.'],
        recommendedNextSteps: status === 'healthy' ? [] : ['Drill into the non-healthy sub-capabilities for evidence.'],
      };
    },
  };
}

const DOMAIN: DiagnosticCapability[] = [serviceHealth, logs, metrics, database, dns, tls, http, mail, storage];

/** Anchor set (kept for commit-1 test imports). */
export function coreCapabilities(): DiagnosticCapability[] {
  return [serviceHealth];
}

/** Full default capability set: every read-only domain + the summary aggregator. */
export function defaultCapabilities(): DiagnosticCapability[] {
  return [...DOMAIN, makeSummary(DOMAIN)];
}
