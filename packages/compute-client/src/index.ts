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
 *
 * Versions:
 *   1.0.0  six operations
 *   1.1.0  seven operations - adds recordObservation() -> POST /observations
 *
 * Distinct from the Studio ACCEPTANCE framework version, which is also 1.1.0 and is an unrelated
 * axis. Same number, different meaning; never conflate them.
 */
export const CLIENT_CONTRACT_VERSION = "1.1.0";

/**
 * Parse a strict x.y.z, or null if it is not a version at all.
 *
 * Returns a fixed-length TUPLE built from the capturing groups rather than a `number[]` from
 * split/map. Under `noUncheckedIndexedAccess` — which the monorepo that also carries this file
 * enables and Studio does not — an array index is `number | undefined`, so the array form does not
 * typecheck there. The tuple carries the arity in its type, which is true of this value anyway.
 */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * May this client interpret a response from an authority advertising `advertised`?
 *
 * Exact equality was the previous rule, and it turns an ADDITIVE bump into a breaking one: the
 * moment the authority moved to 1.1.0, every 1.0.0 client would refuse every response - including
 * responses to the six operations that had not changed at all. That would make "additive" true on
 * paper and false in practice.
 *
 * The rule that matches the guarantee the version actually makes:
 *
 *   same major, authority >= client   accept. Every operation this client knows still exists and
 *                                     behaves the same; new response fields are optional and go unread.
 *   authority OLDER than client       refuse. This client may call an operation the authority has
 *                                     never had - the skew case, and the dangerous direction.
 *   different major                   refuse. A major bump is where behaviour may change beneath a
 *                                     name this client already knows.
 */
function canInterpret(advertised: string): boolean {
  const a = parseSemver(advertised);
  const c = parseSemver(CLIENT_CONTRACT_VERSION);
  if (!a || !c) return false;
  // Unrolled to LITERAL indices on purpose. A variable index stays possibly-undefined even against
  // a tuple, so the loop form fails under noUncheckedIndexedAccess. Verified equivalent to the loop
  // across all 2304 version pairs in major 0-2 / minor 0-3 / patch 0-3 on both sides: no differences.
  if (a[0] !== c[0]) return false;
  if (a[1] !== c[1]) return a[1] > c[1];
  return a[2] >= c[2];
}

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
    /**
     * How requiredMib was derived. "peak" is a measured ceiling and a shortfall against it is
     * physical; "demonstrated-floor" is a witnessed lower bound on an offloading engine, where a
     * shortfall means only that no run has been observed that low — never that it cannot work.
     * A client must not render the second as an unoverridable refusal.
     */
    requiredBasis?: "peak" | "demonstrated-floor" | "caller-estimate" | "stated-minimum" | "none" | null;
  }>;
  /** Peak VRAM observed for this pipeline/variant. An observation, not an admission gate. */
  vramEvidence?: { known?: boolean; matched?: string; peakVramMib?: number | null; crossTarget?: boolean };
  /** What must be FREE for the job to start, and on what evidence. */
  admissionEvidence?: {
    known?: boolean; matched?: string; basis?: string; admissionMib?: number | null;
    peakVramMib?: number | null; offloadProven?: boolean; crossTarget?: boolean; note?: string;
  };
  /** Stated by the authority so a plan can never be mistaken for an execution. */
  sideEffects: string;
  error?: string;
}

/**
 * What a render OBSERVED when it reached a terminal state.
 *
 * Split deliberately into `requested` and `actual`: only the observed side may inform placement.
 * A peak may carry a number only when sampling covered the whole run, which is why the status is a
 * separate field rather than an inference from null.
 */
export interface ExecutionObservation {
  /** Identity of this render attempt, and the idempotency key. */
  runId: string;
  pipeline: string;
  variant?: string | null;
  outcome: "completed" | "failed" | "cancelled";
  executionMode: "local" | "remote";
  executionTarget: string;
  peakVramStatus: "MEASURED" | "PARTIAL" | "NOT_MEASURED";
  peakVramMib?: number | null;
  freeVramAtStartMib?: number | null;
  /** Required when outcome is "completed"; meaningless otherwise, since a cancelled run has no known duration. */
  runtimeSeconds?: number | null;
  /** Required when outcome is "cancelled", e.g. "CANCELLED_LATENCY_BOUNDARY". */
  cancellationReason?: string | null;
  error?: string | null;
  model?: string | null;
  precision?: string | null;
  gpu?: string | null;
  provider?: string | null;
  requested?: Record<string, unknown> | null;
  actual?: Record<string, unknown> | null;
  outputBytes?: number | null;
  provenance?: string | null;
}

export interface RecordObservationResult {
  ok: boolean;
  recorded: boolean;
  duplicate: boolean;
  runId?: string | null;
  total?: number;
  error?: string;
  errors?: string[];
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
    // Every request declares the wire contract it was written against — ALL SIX operations,
    // /capabilities included. The authority refuses a request that does not — missing, older and
    // newer alike — before interpreting it, because the version is what says how to interpret it.
    //
    // /capabilities is exempt on the AUTHORITY side ONLY: it answers a request declaring no version,
    // or an unsupported one, because a client cannot be required to know the contract before it has
    // any way to discover it. That exemption is the authority's to GRANT, not the client's to TAKE.
    // This client sends the header there too. The previous wording called discovery "the one
    // exemption" here, which described behaviour this code does not have — headers are built once,
    // with no per-path branch — and would have invited someone to remove it and call that a fix.
    const headers: Record<string, string> = {
      "x-migraai-actor": this.actor,
      "x-migraai-contract-version": CLIENT_CONTRACT_VERSION,
    };
    if (opts.reason) headers["x-migraai-reason"] = opts.reason;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await this.f(`${this.baseUrl}${path}`, {
      method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    /*
     * THE AUTHORITY ANNOUNCES ITS CONTRACT ON EVERY RESPONSE, AND NOTHING WAS LISTENING.
     *
     * Sending the version was only half the handshake. The authority refuses a request whose
     * declared version it does not support; a client that never reads the version coming BACK
     * discovers a moved authority as a storm of 409s, one per call, with nothing saying why. The
     * header is the authority telling every client exactly what it speaks — checking it turns a
     * silent fork into one refusal that names both sides.
     *
     * Checked BEFORE the body is read, mirroring the authority's own order: the version is what
     * says how to interpret the bytes, so interpreting them first would be reading a document in a
     * language you have not confirmed.
     *
     * A MISMATCH always refuses, including on an error response — a 409 from a drifted authority is
     * explained by the drift, and reporting only the status would hide the cause behind its effect.
     * An ABSENT header refuses only on success: a proxy or gateway can return 502 without ever
     * reaching the authority, and calling that a contract fault would blame the wrong component.
     * A 2xx with no version is different — something answered as the authority without identifying
     * itself as one, and an unversioned success is exactly the thing that must not be interpreted.
     */
    const advertised = res.headers?.get("x-migraai-contract-version") ?? null;
    if (advertised !== null && !canInterpret(advertised)) {
      throw new ComputeAuthorityError(
        res.status,
        `authority speaks contract ${advertised}, this client speaks ${CLIENT_CONTRACT_VERSION} — ` +
          `refusing to interpret the response rather than guessing at a contract it was not written against`,
      );
    }
    if (res.ok && advertised === null) {
      throw new ComputeAuthorityError(
        res.status,
        "authority did not advertise a contract version on a successful response — refusing to " +
          "interpret an unversioned answer as if it came from a known contract",
      );
    }

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

  /**
   * Record one terminal render attempt as scheduling evidence.
   *
   * No reason header: this is append-only evidence, not spend. Idempotent on runId, so a retry
   * after a timeout is safe and returns duplicate:true rather than double-counting the run.
   */
  recordObservation(observation: ExecutionObservation): Promise<RecordObservationResult> {
    return this.call<RecordObservationResult>("POST", "/observations", { body: observation });
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
