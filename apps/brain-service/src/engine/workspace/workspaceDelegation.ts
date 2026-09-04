/*
 * WHERE THE WORKSPACE ACTUALLY IS.
 *
 * Workspace tools used to run on this host, which was correct while the Brain
 * ran on the developer's machine. Once the Brain moved to a shared governed
 * server that assumption silently inverted: `/home/<someone>/project` does not
 * exist here, so file reads failed and — worse — a directory listing came back
 * EMPTY, teaching the agent that the project had no files and inviting it to
 * invent some.
 *
 * The fix is not to copy the workspace to the server. The client is the only
 * party that legitimately holds the files, so the client executes those tools:
 * the Brain plans, decides and governs; the extension reads and writes.
 *
 * SHAPE. The transport is the existing SSE stream plus a small callback:
 *
 *   Brain  --  event: tool_request {callId, tool, input}  -->  extension
 *   Brain  <--  POST /api/ai/engineer/tool-result         <--  extension
 *
 * Everything stays client-initiated, so it works through NAT and needs no
 * inbound path to the developer's machine. The agent loop is unchanged: it
 * awaits `executeTool` exactly as before and cannot tell where the work ran.
 *
 * A DELEGATED CALL MUST ALWAYS SETTLE. A client that closes its stream, crashes,
 * or simply never answers would otherwise suspend the loop forever, so every
 * call carries a deadline and every delegate is disposed when its stream ends.
 * A timeout surfaces as a tool FAILURE, which the agent already knows how to
 * handle — it is never reported as an empty or successful result, because that
 * is the exact lie this module exists to remove.
 */

/*
 * Tools whose answer depends on the caller's filesystem, so the caller must run
 * them. NOT a list maintained here: it is derived from the canonical registry in
 * @migrapilot/workspace-tools, so a tool cannot be delegated without also being
 * classified, and cannot be classified one way here and another way in the
 * client. A hand-kept copy in this file was the drift risk itself.
 */
import { CLIENT_EXECUTABLE_TOOL_IDS } from '@migrapilot/workspace-tools';

export const CLIENT_WORKSPACE_TOOLS: ReadonlySet<string> = new Set(CLIENT_EXECUTABLE_TOOL_IDS);

export interface DelegatedCall {
  callId: string;
  tool: string;
  input: unknown;
}

/** What the client reports back. `ok: false` is a normal outcome, not a transport fault. */
export type DelegatedOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export class DelegationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DelegationError';
  }
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  tool: string;
}

/** Default deadline for one client-side tool call. Generous for a big repo scan, far short of forever. */
export const DEFAULT_DELEGATION_TIMEOUT_MS = 60_000;

export class WorkspaceDelegate {
  private readonly pending = new Map<string, PendingCall>();
  private seq = 0;
  private disposed = false;

  constructor(
    private readonly emit: (call: DelegatedCall) => void,
    private readonly timeoutMs: number = DEFAULT_DELEGATION_TIMEOUT_MS,
  ) {}

  /** How many calls are still in flight — used by tests and diagnostics. */
  get inFlight(): number {
    return this.pending.size;
  }

  /** Ask the client to run one tool and await its answer. */
  request(tool: string, input: unknown): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new DelegationError(`the client stream ended before ${tool} could run`));
    }
    this.seq += 1;
    const callId = `wd_${this.seq.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(
          new DelegationError(
            `${tool} timed out after ${Math.round(this.timeoutMs / 1000)}s waiting for the client workspace`,
          ),
        );
      }, this.timeoutMs);
      /*
       * Deliberately NOT unref'd. An unref'd timer does not fire when nothing
       * else is pending, which is precisely the moment a stuck call most needs
       * to fail — and it made the timeout untestable, because the runner's loop
       * drained before it could fire. Orphans are prevented by disposal instead:
       * both the stream-close handler and the completion path unregister the
       * delegate, which clears every timer it owns.
       */
      this.pending.set(callId, { resolve, reject, timer, tool });
      try {
        this.emit({ callId, tool, input });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(callId);
        reject(new DelegationError(`could not reach the client to run ${tool}: ${(err as Error).message}`));
      }
    });
  }

  /** Deliver a client's answer. Returns false when the call is unknown or already settled. */
  settle(callId: string, outcome: DelegatedOutcome): boolean {
    const call = this.pending.get(callId);
    if (!call) return false;
    clearTimeout(call.timer);
    this.pending.delete(callId);
    if (outcome.ok) call.resolve(outcome.result);
    else call.reject(new DelegationError(outcome.error || `${call.tool} failed on the client`));
    return true;
  }

  /** End the delegate, failing everything still waiting. Idempotent. */
  dispose(reason = 'the client stream ended'): void {
    this.disposed = true;
    for (const [callId, call] of this.pending) {
      clearTimeout(call.timer);
      this.pending.delete(callId);
      call.reject(new DelegationError(`${call.tool} was abandoned: ${reason}`));
    }
  }
}

/*
 * Active delegates, keyed by the run's correlation id.
 *
 * The result callback is a separate HTTP request, so it needs a way back to the
 * suspended run. The correlation id is already unguessable and already the
 * identifier the audit trail uses, which keeps one notion of "which run".
 */
const active = new Map<string, WorkspaceDelegate>();

export function registerDelegate(correlationId: string, delegate: WorkspaceDelegate): void {
  active.set(correlationId, delegate);
}

export function delegateFor(correlationId: string): WorkspaceDelegate | undefined {
  return active.get(correlationId);
}

export function unregisterDelegate(correlationId: string): void {
  const delegate = active.get(correlationId);
  active.delete(correlationId);
  delegate?.dispose();
}

/** Open delegate count — for a health surface, and to prove disposal in tests. */
export function activeDelegateCount(): number {
  return active.size;
}
