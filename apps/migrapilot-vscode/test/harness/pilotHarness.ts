/**
 * Extension test harness. Captures the exact transcript a real chat turn would
 * produce by recording every StreamHandlers callback in order. Drives the REAL
 * PilotClient (apps/migrapilot-vscode/src/pilotClient.ts) — the same code path
 * VS Code uses — against a controllable local SSE server. The client is never
 * reimplemented here.
 */
import { PilotClient, StreamHandlers, ChatTurn, ChatRequestContext, ProposalCardData } from "../../src/pilotClient";
import { __setConfig, __resetConfig } from "./vscodeMock";
import type { ExecutionPlan, PhaseUpdate } from "../../src/planStream";
import type { ApprovalCardData } from "../../src/pilotClient";

export interface TranscriptEvent {
  kind: "delta" | "step" | "done" | "error" | "aborted";
  value?: string;
}

export class Transcript {
  public readonly events: TranscriptEvent[] = [];
  public readonly proposals: ProposalCardData[] = [];
  /** Phase D — approval cards: a live mutation waiting for a human. */
  public readonly approvals: ApprovalCardData[] = [];
  public readonly plans: ExecutionPlan[] = [];
  public readonly phases: PhaseUpdate[] = [];
  public get deltas(): string[] { return this.events.filter((e) => e.kind === "delta").map((e) => e.value!); }
  public get steps(): string[] { return this.events.filter((e) => e.kind === "step").map((e) => e.value!); }
  public get fullText(): string | undefined { return this.events.find((e) => e.kind === "done")?.value; }
  public get error(): string | undefined { return this.events.find((e) => e.kind === "error")?.value; }
  public get aborted(): boolean { return this.events.some((e) => e.kind === "aborted"); }
  public get completed(): boolean { return this.events.some((e) => e.kind === "done"); }
  public handlers(): StreamHandlers {
    return {
      onDelta: (t) => this.events.push({ kind: "delta", value: t }),
      onStep: (t) => this.events.push({ kind: "step", value: t }),
      onProposal: (card) => this.proposals.push(card),
      onApprovalRequest: (card) => this.approvals.push(card),
      onPlan: (plan) => this.plans.push(plan),
      onPhase: (update) => this.phases.push(update),
      onDone: (t) => this.events.push({ kind: "done", value: t }),
      onError: (m) => this.events.push({ kind: "error", value: m }),
      onAborted: () => this.events.push({ kind: "aborted" }),
    };
  }
}

/** Build a PilotClient bound to a given pilot-api base URL and config. */
export function makeClient(config: Record<string, unknown> = {}): PilotClient {
  __resetConfig();
  __setConfig({ "migrapilot.backend": "pilot-api", ...config });
  return new PilotClient();
}

export async function runChat(
  client: PilotClient,
  message: string,
  opts: { model?: string; history?: ChatTurn[]; context?: ChatRequestContext; signal?: AbortSignal; workspaceId?: string } = {}
): Promise<Transcript> {
  const t = new Transcript();
  await client.streamChat(message, opts.context, t.handlers(), opts.model, opts.history, opts.signal, opts.workspaceId);
  return t;
}

export { __setConfig, __resetConfig };
