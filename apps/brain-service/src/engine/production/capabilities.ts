// Operational Readiness Slice 5 — read-only diagnostic capability implementations.
//
// Each capability is READ-ONLY: it reads a signal through the Prober (or the
// registry's approved endpoints) and returns evidence. None mutate. Status is
// derived from evidence — never "healthy" merely because a connection opened.
//
// Commit 1 seeds serviceHealth (the anchor). Commit 2 adds the remaining domains.
//
// © MigraTeck LLC.

import type { DiagnosticResult } from './types.js';
import type { CapabilityRunContext, DiagnosticCapability } from './provider.js';

/** Service & process health (read-only): existence, state, uptime, restarts,
 * version identity, dependency reachability. */
const serviceHealth: DiagnosticCapability = {
  id: 'production.diagnostics.serviceHealth',
  description: 'Read-only service/process health: state, uptime, restarts, version, dependency reachability.',
  async run(ctx: CapabilityRunContext): Promise<DiagnosticResult> {
    const endpoint = ctx.params.endpointId ? ctx.registry.endpoint(ctx.target, ctx.params.endpointId) : undefined;
    const s = await ctx.prober.serviceStatus(ctx.target, endpoint);

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

    let status: DiagnosticResult['status'] = 'unknown';
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
      // A running service with an unreachable dependency was already classified
      // 'degraded' above, so reaching here means dependencies are not-unreachable.
      status = 'healthy';
      interpretation = 'Service is running and dependencies are reachable.';
    } else {
      limitations.push('State signal was inconclusive under the read-only probe.');
    }

    return { status, observations, evidence, interpretation, limitations, recommendedNextSteps: nextSteps };
  },
};

/** Commit-1 capability set (anchor). Commit 2 appends the remaining domains via
 * {@link additionalCapabilities}. */
export function coreCapabilities(): DiagnosticCapability[] {
  return [serviceHealth];
}

/** Full default capability set. Commit 2 replaces the body to include every
 * `production.diagnostics.*` domain. */
export function defaultCapabilities(): DiagnosticCapability[] {
  return [...coreCapabilities()];
}
