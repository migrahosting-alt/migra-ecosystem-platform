/**
 * Typed client for the Shared Compute Authority.
 *
 * This package is a CONTRACT, not an implementation. It contains zero provider logic, zero
 * scheduling, zero evidence adjudication, zero reconciliation and zero lifecycle mutation. It only
 * says how to talk to the authority.
 *
 * That distinction is the whole point of the topology: shipping the authority as a library would
 * give Studio, Brain, Engineer and MigraPilot an instance each, able to plan, provision and
 * reconcile independently and race over the same job. One authority, four clients, one contract.
 */


/**
 * The wire contract this client speaks. Sent on every request and checked by the authority
 * before the request is read. It is a constant, not a parameter: a client that could be told
 * to claim a different version could be told to claim a compatible one it does not implement.
 */
export const CLIENT_CONTRACT_VERSION = "1.0.0";

export type ExecutionTarget = "local/windows" | "local/wsl" | "remote/runpod";
export type CallerIdentity = "studio" | "brain" | "engineer" | "migrapilot" | "operator";

export type LifecycleState =
  | "queued" | "analyzing_requirements" | "selecting_compute" | "acquiring_resource" | "provisioning"
  | "staging_inputs" | "preparing_runtime" | "running" | "checkpointing" | "workload_completed"
  | "persisting_outputs" | "verifying_outputs" | "terminating" | "reconciling" | "completed"
  | "recovery_required" | "cleanup_required" | "failed" | "cancelled";

/** What a caller asks for. The authority decides everything else. */
export interface JobRequest {
  jobId: string;
  pipeline: string;
  variant?: string | null;
  model?: { id?: string | null; hash?: string | null };
  inputs?: Array<{ uri: string; sha256?: string; bytes?: number }>;
  outputs?: { destination?: string; expect?: Array<{ kind: string; minBytes?: number }> };
  requirements?: {
    gpuCount?: number; minVramMib?: number; requiresRuntime?: "linux" | "windows";
    width?: number; height?: number; frames?: number; steps?: number; precision?: string;
    expectedRuntimeSeconds?: number;
  };
  /** Governance constraints. The authority resolves these against its own envelope and can only tighten. */
  policy?: { remoteAllowed?: boolean; maxHourlyUsd?: number; maxJobUsd?: number; maxRemoteScenes?: number };
  runtime?: unknown;
  workload?: unknown;
  evidenceDir?: string;
}

export interface PlanResult {
  ok: boolean;
  decision: "local" | "remote" | "blocked_reclaim_local";
  target: ExecutionTarget | null;
  remoteBlocked: boolean;
  fingerprint: { key: string; parts: Record<string, unknown> };
  evaluations: Array<{
    target: string; qualified: boolean; class: string | null; requiredMib: number | null;
    requiredSource: string | null; ceilingMib: number | null; usableNowMib: number | null;
    gpu: string | null; reasons: string[];
  }>;
  /** Stated by the authority so a plan can never be mistaken for an execution. */
  sideEffects: string;
  error?: string;
}

export interface JobState {
  ok: boolean;
  jobId: string; allocationId: string;
  lifecycleState: LifecycleState;
  executionTarget: string | null;
  artifactStatus: string;
  /** True while remote compute is still being paid for. */
  resourceRetained: boolean;
  reconciledAt: string | null;
  updatedAt: string | null;
  history: Array<{ state: string; at: string; detail: string | null }>;
  error?: string;
}

export class ComputeAuthorityError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
    this.name = "ComputeAuthorityError";
  }
}

export interface ClientOptions {
  baseUrl?: string;
  actor: CallerIdentity;
  fetchImpl?: typeof fetch;
}

export class ComputeClient {
  private readonly baseUrl: string;
  private readonly actor: CallerIdentity;
  private readonly f: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = (opts.baseUrl ?? process.env.MIGRAAI_COMPUTE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
    this.actor = opts.actor;
    this.f = opts.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, path: string, opts: { body?: unknown; reason?: string } = {}): Promise<T> {
    // Every request declares the wire contract it was written against. The authority refuses a
    // request that does not — missing, older and newer alike — before interpreting it, because the
    // version is what says how to interpret it. Discovery (GET /capabilities) is the one exemption.
    const headers: Record<string, string> = {
      "x-migraai-actor": this.actor,
      "x-migraai-contract-version": CLIENT_CONTRACT_VERSION,
    };
    if (opts.reason) headers["x-migraai-reason"] = opts.reason;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await this.f(`${this.baseUrl}${path}`, {
      method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new ComputeAuthorityError(res.status, `authority returned non-JSON: ${text.slice(0, 200)}`); }
    if (!res.ok) {
      const msg = (parsed as { error?: string })?.error ?? `HTTP ${res.status}`;
      throw new ComputeAuthorityError(res.status, msg, parsed);
    }
    return parsed as T;
  }

  /** What WOULD happen. Read-only — safe to call from a UI. */
  plan(job: JobRequest): Promise<PlanResult> {
    return this.call<PlanResult>("POST", "/plan", { body: job });
  }

  /** Make it happen. Requires a reason: spend is recorded with who and why. */
  submit(job: JobRequest, reason: string): Promise<{ ok: boolean; accepted: boolean; mode: string; provider?: string; result?: unknown }> {
    if (!reason) throw new ComputeAuthorityError(400, "submit requires a reason — spend must record why");
    return this.call("POST", "/jobs", { body: job, reason });
  }

  getState(jobId: string): Promise<JobState> {
    return this.call<JobState>("GET", `/jobs/${encodeURIComponent(jobId)}`);
  }

  cancel(jobId: string, reason: string): Promise<{ ok: boolean; accepted: boolean; deferred?: boolean; note?: string; reason?: string }> {
    if (!reason) throw new ComputeAuthorityError(400, "cancel requires a reason");
    return this.call("POST", `/jobs/${encodeURIComponent(jobId)}/cancel`, { reason });
  }

  getEvidence(jobId: string): Promise<Record<string, unknown>> {
    return this.call("GET", `/jobs/${encodeURIComponent(jobId)}/evidence`);
  }

  getCapabilities(): Promise<Record<string, unknown>> {
    return this.call("GET", "/capabilities");
  }
}
