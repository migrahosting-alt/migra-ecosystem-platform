// POST /api/pilot/runs/:id/approve — Phase 8, persistence Phase 9.9.
// Approves or cancels a paused run's pending tool. The pending → approved/cancelled
// transition is ATOMIC (exact-once) via the approval store; on approval the EXACT stored
// action/args are re-classified and executed once (blocked actions never run), then the
// agent loop resumes (streamed NDJSON).

import { runTool } from "../../../../../../lib/pilot/tools";
import { classifyPilotAction } from "../../../../../../lib/pilot/policy";
import { streamPilotRun } from "../../../../../../lib/pilot/orchestrator";
import { addAudit, getRun, getRunConvo, id, saveRun } from "../../../../../../lib/pilot/store";
import { cancelApproval, claimApproval, getApprovalRecord, markApprovalBlocked, markApprovalExecuted } from "../../../../../../lib/pilot/approval-store";
import type { PilotEvent } from "../../../../../../lib/pilot/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const now = () => new Date().toISOString();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: runId } = await ctx.params;
  let body: { approvalId?: unknown; decision?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
  const decision = body.decision === "approve" ? "approve" : body.decision === "deny" ? "deny" : "";

  const run = getRun(runId);
  const approval = await getApprovalRecord(approvalId);
  const convo = getRunConvo(runId);

  if (!run) return json({ error: "run not found" }, 404);
  if (!approval || approval.runId !== runId) return json({ error: "approval not found" }, 404);
  if (approval.status !== "pending") return json({ error: `approval already ${approval.status}` }, 409);
  if (!decision) return json({ error: "decision must be 'approve' or 'deny'" }, 400);
  if (!convo) return json({ error: "run context expired" }, 409);

  // Atomic transition BEFORE streaming → exact-once. A second concurrent request loses the race.
  const claimed = decision === "approve" ? await claimApproval(approvalId) : await cancelApproval(approvalId);
  if (!claimed) {
    const fresh = await getApprovalRecord(approvalId);
    return json({ error: `approval already ${fresh?.status ?? "gone"}` }, 409);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PilotEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const step = run.steps.find((s) => s.id === claimed.stepId);

      try {
        if (decision === "approve") {
          // Re-classify the EXACT stored action/args. A blocked action never executes, even when approved.
          const recheck = classifyPilotAction(claimed.toolName, claimed.args);
          if (recheck.blocked) {
            await markApprovalBlocked(claimed.id, recheck.reason);
            if (step) { step.title = `🚫 blocked: ${claimed.toolName}`; step.status = "failed"; step.endedAt = now(); step.detail = recheck.reason; }
            addAudit({ id: id("aud"), runId, ts: now(), kind: "action.blocked", detail: `${claimed.toolName}: ${recheck.reason}` });
            convo.push({ role: "tool", content: `BLOCKED on execution: ${recheck.reason}. Not permitted.`, tool_name: claimed.toolName });
          } else {
            const res = await runTool(claimed.toolName, claimed.args, { approved: true });
            await markApprovalExecuted(claimed.id, res.output.slice(0, 160));
            if (step) {
              step.title = `🔧 ${claimed.toolName}`;
              step.status = res.ok ? "done" : "failed";
              step.endedAt = now();
              step.detail = res.output.slice(0, 160);
            }
            addAudit({ id: id("aud"), runId, ts: now(), kind: "approval.approved", detail: claimed.toolName });
            addAudit({ id: id("aud"), runId, ts: now(), kind: "tool.executed", detail: `${claimed.toolName} -> ${res.ok ? "ok" : "error"}` });
            convo.push({ role: "tool", content: res.output, tool_name: claimed.toolName });
          }
        } else {
          if (step) { step.title = `🚫 cancelled: ${claimed.toolName}`; step.status = "failed"; step.endedAt = now(); }
          addAudit({ id: id("aud"), runId, ts: now(), kind: "approval.cancelled", detail: claimed.toolName });
          convo.push({ role: "tool", content: "The user CANCELLED this action. Do not attempt it again; continue and answer without performing it.", tool_name: claimed.toolName });
        }

        run.pendingApprovalId = undefined;
        run.status = "running";
        saveRun(run);
        if (step) send({ type: "step", step });

        await streamPilotRun(run, convo, send);
      } catch (err) {
        run.status = "failed";
        run.endedAt = now();
        saveRun(run);
        send({ type: "error", error: err instanceof Error ? err.message : "unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform" },
  });
}
