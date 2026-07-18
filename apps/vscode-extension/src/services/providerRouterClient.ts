// Intelligent Provider Router — Slice 5: typed client boundary for the read-only
// provider/policy/budget/usage APIs + the escalation approval endpoint.
//
// The server (Slices 1–4) is authoritative. This client only READS state and
// submits a server-issued escalation offer reference for approval. It never
// computes routing, pricing, budget, or consent, and never invokes a cloud
// provider directly. Typed responses make API-contract drift fail visibly.
//
// © MigraTeck LLC.

export interface ProviderRouterClientConfig {
  baseUrl: () => string;
  timeoutMs: () => number;
  log: (message: string) => void;
}

export type ProviderKind = 'local' | 'cloud';
export type PolicyId = 'auto' | 'local-first' | 'local-only' | 'cloud-first' | 'best-quality' | 'lowest-cost' | 'privacy-first' | 'custom';

export interface PolicyDef {
  id: PolicyId;
  displayName: string;
  description: string;
}

export interface ProviderHealthView {
  status: 'healthy' | 'degraded' | 'unreachable' | 'unknown' | 'disabled';
  detail?: string;
}
export interface ProviderView {
  id: string;
  displayName: string;
  kind: ProviderKind;
  enabled: boolean;
  hasCredential: boolean;
  dataLocality: 'on-device' | 'external';
  health: ProviderHealthView;
  effectiveCapabilities: Record<string, boolean>;
  models: Array<{ id: string; tier: string }>;
}
export interface ProvidersResponse {
  mode: string;
  defaultPolicy: PolicyId;
  providers: ProviderView[];
}

export interface BudgetScopeView {
  kind: string;
  key: string;
  enabled: boolean;
  hardLimitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  warningThreshold: number;
}
export interface BudgetResponse {
  enabled: boolean;
  currency: string;
  scopes: BudgetScopeView[];
}

export interface UsageRecordView {
  usageId: string;
  providerId: string;
  modelId: string;
  localOrCloud: ProviderKind;
  costUsd?: number;
  costStatus: 'actual' | 'estimated' | 'unknown';
  estimatedSavingsUsd?: number;
  localCostStatus?: 'estimated' | 'unknown';
  outcome: string;
}
export interface UsageResponse {
  records: UsageRecordView[];
  summary: {
    cloud: { count: number; costUsd: number };
    local: { count: number; estimatedSavingsUsd: number; savingsStatus: 'estimated' | 'unknown' };
    byProvider: Record<string, { count: number; costUsd: number }>;
  };
}

export interface EscalationApproveResult {
  ok: boolean;
  code?: string;
  error?: string;
  correlationId?: string;
  escalation?: { provider: string; model: string; reason: string; viaEscalation: true };
  content?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export class ProviderRouterError extends Error {
  constructor(readonly kind: 'transport' | 'timeout' | 'http', readonly status: number, message: string) {
    super(message);
    this.name = 'ProviderRouterError';
  }
}

export class ProviderRouterClient {
  constructor(private readonly cfg: ProviderRouterClientConfig) {}

  private base(): string {
    return this.cfg.baseUrl().replace(/\/+$/, '');
  }

  /** Transport that throws only on network/timeout; returns {status, json} so a
   * caller can decide whether a 4xx is an error or a meaningful body. */
  private async rawRequest(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; json: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs());
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort);
    const url = `${this.base()}${path}`;
    this.cfg.log(`${method} ${url}`);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = controller.signal.aborted;
      throw new ProviderRouterError(timedOut ? 'timeout' : 'transport', 0, timedOut ? 'request timed out' : `network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    const text = await res.text();
    let json: unknown;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, json };
  }

  private async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const { status, json } = await this.rawRequest(method, path, body, signal);
    if (status < 200 || status >= 300) {
      const code = (json as { code?: string } | undefined)?.code;
      throw new ProviderRouterError('http', status, code ? `${code} (HTTP ${status})` : `HTTP ${status}`);
    }
    return json as T;
  }

  getProviders(signal?: AbortSignal): Promise<ProvidersResponse> {
    return this.request('GET', '/api/ai/providers', undefined, signal);
  }
  getPolicies(signal?: AbortSignal): Promise<{ policies: PolicyDef[]; default: PolicyId }> {
    return this.request('GET', '/api/ai/providers/policies', undefined, signal);
  }
  getPlan(policy: PolicyId, hints?: Record<string, unknown>, signal?: AbortSignal): Promise<{ ok: boolean; plan: unknown }> {
    return this.request('POST', '/api/ai/providers/plan', { policy, hints }, signal);
  }
  getBudget(signal?: AbortSignal): Promise<BudgetResponse> {
    return this.request('GET', '/api/ai/providers/budget', undefined, signal);
  }
  getUsage(query: { provider?: string; localOrCloud?: ProviderKind; limit?: number } = {}, signal?: AbortSignal): Promise<UsageResponse> {
    const q = new URLSearchParams();
    if (query.provider) q.set('provider', query.provider);
    if (query.localOrCloud) q.set('localOrCloud', query.localOrCloud);
    if (query.limit) q.set('limit', String(query.limit));
    const qs = q.toString();
    return this.request('GET', `/api/ai/providers/usage${qs ? `?${qs}` : ''}`, undefined, signal);
  }
  getUsageByCorrelation(correlationId: string, signal?: AbortSignal): Promise<{ correlationId: string; records: UsageRecordView[] }> {
    return this.request('GET', `/api/ai/providers/usage/${encodeURIComponent(correlationId)}`, undefined, signal);
  }
  /** Submit ONLY the server-issued offer reference + the bound request. The client
   * never reconstructs provider/model/reason/ceiling. */
  async approveEscalation(offerId: string, token: string, request: unknown, signal?: AbortSignal): Promise<EscalationApproveResult> {
    // A gate rejection (400/403/409) or a failed attempt (502) returns a typed
    // body the UI must show — not a thrown error. Only transport/timeout throws.
    const { status, json } = await this.rawRequest('POST', '/api/ai/escalation/approve', { offerId, token, request }, signal);
    const body = (json ?? {}) as EscalationApproveResult;
    return { ...body, ok: status >= 200 && status < 300 && body.ok !== false };
  }
}
