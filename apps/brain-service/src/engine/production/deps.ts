// Operational Readiness Slice 5 — the READ-ONLY probe layer.
//
// A Prober is the ONLY way a diagnostic capability reaches a production target.
// Every method is read-only by contract; there is deliberately no write, restart,
// deploy, exec, or mutation method on this interface — a mutation capability
// cannot be added later without changing this contract in review. Tests inject a
// deterministic fake; live acceptance injects a controlled read-only prober.
//
// © MigraTeck LLC.

import type { ApprovedEndpoint, ProductionTarget } from './targetRegistry.js';

export interface ServiceStatus {
  exists: boolean;
  state?: 'running' | 'stopped' | 'restarting' | 'crashed' | 'unknown';
  uptimeSec?: number;
  restartCount?: number;
  versionId?: string;
  dependencyReachable?: boolean;
}

export interface MetricsSnapshot {
  cpuPercent?: number;
  memoryPercent?: number;
  diskPercent?: number;
  load1?: number;
  networkOk?: boolean;
}

export interface DatabaseHealth {
  reachable: boolean;
  serverVersion?: string;
  connectionsUsed?: number;
  connectionsMax?: number;
  replicationHealthy?: boolean;
  migrationState?: string;
}

export interface DnsResult {
  reachable: boolean;
  records: string[];
  matchesExpected?: boolean;
  protocolError?: string;
}

export interface TlsResult {
  reachable: boolean;
  daysToExpiry?: number;
  hostnameMatch?: boolean;
  chainValid?: boolean;
  protocolError?: string;
}

export interface HttpResult {
  reachable: boolean;
  status?: number;
  latencyMs?: number;
  redirects?: number;
  safeHeaders?: Record<string, string>;
}

export interface MailHealth {
  reachable: boolean;
  dnsOk?: boolean;
  tlsOk?: boolean;
  queueDepth?: number;
  authConfigured?: boolean;
}

export interface StorageHealth {
  reachable: boolean;
  capacityPercent?: number;
  latencyMs?: number;
  replicationHealthy?: boolean;
}

/** READ-ONLY probe surface. No mutation methods — by design. */
export interface Prober {
  serviceStatus(target: ProductionTarget, endpoint?: ApprovedEndpoint): Promise<ServiceStatus>;
  readLogs(target: ProductionTarget, opts: { windowMinutes: number; maxLines: number }): Promise<string[]>;
  readMetrics(target: ProductionTarget): Promise<MetricsSnapshot>;
  databaseHealth(target: ProductionTarget): Promise<DatabaseHealth>;
  resolveDns(endpoint: ApprovedEndpoint): Promise<DnsResult>;
  inspectTls(endpoint: ApprovedEndpoint): Promise<TlsResult>;
  httpProbe(endpoint: ApprovedEndpoint): Promise<HttpResult>;
  mailHealth(target: ProductionTarget, endpoint?: ApprovedEndpoint): Promise<MailHealth>;
  storageHealth(target: ProductionTarget, endpoint?: ApprovedEndpoint): Promise<StorageHealth>;
}

/** Default prober used when no real read-only backend is wired. It NEVER fabricates
 * health: infra checks report unreachable/unknown rather than "healthy". The real
 * network probers (DNS/TLS/HTTP) are provided in the network prober (commit 2). */
export class NullProber implements Prober {
  async serviceStatus(_target: ProductionTarget, _endpoint?: ApprovedEndpoint): Promise<ServiceStatus> {
    return { exists: false, state: 'unknown' };
  }
  async readLogs(_target: ProductionTarget, _opts: { windowMinutes: number; maxLines: number }): Promise<string[]> {
    return [];
  }
  async readMetrics(_target: ProductionTarget): Promise<MetricsSnapshot> {
    return {};
  }
  async databaseHealth(_target: ProductionTarget): Promise<DatabaseHealth> {
    return { reachable: false };
  }
  async resolveDns(_endpoint: ApprovedEndpoint): Promise<DnsResult> {
    return { reachable: false, records: [] };
  }
  async inspectTls(_endpoint: ApprovedEndpoint): Promise<TlsResult> {
    return { reachable: false };
  }
  async httpProbe(_endpoint: ApprovedEndpoint): Promise<HttpResult> {
    return { reachable: false };
  }
  async mailHealth(_target: ProductionTarget, _endpoint?: ApprovedEndpoint): Promise<MailHealth> {
    return { reachable: false };
  }
  async storageHealth(_target: ProductionTarget, _endpoint?: ApprovedEndpoint): Promise<StorageHealth> {
    return { reachable: false };
  }
}
