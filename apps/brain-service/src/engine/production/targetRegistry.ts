// Operational Readiness Slice 5 — server-authoritative production target registry.
//
// Clients select a registered `targetId` and an approved `endpointId` ONLY. They
// never submit hosts, ports, URLs, SSH destinations, connection strings, file
// paths, or commands. This is what stops the diagnostics provider from becoming
// SSRF / port-scan / arbitrary-log / command-execution infrastructure.
//
// © MigraTeck LLC.

import type { DiagnosticCapabilityId } from './types.js';

export type Environment = 'production' | 'staging';

export type ServiceType =
  | 'http-service'
  | 'container'
  | 'database'
  | 'dns-zone'
  | 'tls-endpoint'
  | 'mail'
  | 'storage';

/** A server-defined, approved endpoint. The host/port/url live HERE, never in a
 * client request — the client references it by `id`. */
export interface ApprovedEndpoint {
  id: string;
  /** Hostname (already validated + approved by an operator at onboarding). */
  host: string;
  port?: number;
  /** Full URL for http checks (approved; not client-supplied). */
  url?: string;
  /** Expected DNS records for comparison (dns-zone targets). */
  expectedRecords?: string[];
}

export interface ProductionTarget {
  targetId: string;
  tenantId: string;
  environment: Environment;
  serviceType: ServiceType;
  displayName: string;
  approvedEndpoints: ApprovedEndpoint[];
  /** The diagnostic capabilities this target permits. A capability not listed
   * here fails closed (CAPABILITY_NOT_ALLOWED_FOR_TARGET) even if it is a valid,
   * read-only, registered capability. */
  approvedCapabilities: DiagnosticCapabilityId[];
  /** Name of a diagnostics-specific, READ-ONLY credential (resolved server-side;
   * the value never enters a result or the audit chain). Optional for pure
   * network checks (dns/tls/http) that need no credential. */
  credentialRef?: string;
  /** Per-request timeout ceiling for this target (ms). */
  timeoutMs: number;
  /** Max requests per minute against this target. */
  rateLimitPerMinute: number;
  /** Redaction profile name (all profiles redact secrets; this selects extra
   * per-target rules such as also-redact-hostnames for sensitive tenants). */
  redactionProfile: 'standard' | 'strict';
  enabled: boolean;
}

/** Read-only view of a target that is safe to serialize to an operator: NO
 * credential reference, NO raw endpoint hosts/urls (only endpoint ids + a label). */
export interface TargetSummary {
  targetId: string;
  tenantId: string;
  environment: Environment;
  serviceType: ServiceType;
  displayName: string;
  approvedCapabilities: DiagnosticCapabilityId[];
  endpointIds: string[];
  enabled: boolean;
}

export class ProductionTargetRegistry {
  private readonly byId = new Map<string, ProductionTarget>();

  constructor(targets: ProductionTarget[] = []) {
    for (const t of targets) this.byId.set(t.targetId, t);
  }

  /** Resolve a registered + enabled target, or undefined (caller fails closed).
   * A disabled or unknown target is indistinguishable to the client — both are
   * simply "not allowed". */
  resolve(targetId: string): ProductionTarget | undefined {
    const t = this.byId.get(targetId);
    return t && t.enabled ? t : undefined;
  }

  /** All enabled targets as safe summaries (no credentials, no raw hosts). */
  list(): TargetSummary[] {
    return [...this.byId.values()]
      .filter((t) => t.enabled)
      .map((t) => ({
        targetId: t.targetId,
        tenantId: t.tenantId,
        environment: t.environment,
        serviceType: t.serviceType,
        displayName: t.displayName,
        approvedCapabilities: t.approvedCapabilities,
        endpointIds: t.approvedEndpoints.map((e) => e.id),
        enabled: t.enabled,
      }));
  }

  /** Look up an approved endpoint on a target by its server-side id. */
  endpoint(target: ProductionTarget, endpointId: string): ApprovedEndpoint | undefined {
    return target.approvedEndpoints.find((e) => e.id === endpointId);
  }

  size(): number {
    return this.byId.size;
  }
}
