// POST /api/pilot/runs/:id/approve — Phase 8.
// Approves or denies a paused run's pending mutating tool, executes (only on
// approval), audits the decision, and resumes the agent loop (streamed NDJSON).

import { runTool } from "../../../../../../lib/pilot/tools";
import { streamPilotRun } from "../../../../../../lib/pilot/orchestrator";
import { addAudit, getApproval, getRun, getRunConvo, id, saveApproval, saveRun } from "../../../../../../lib/pilot/store";
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
  const approval = getApproval(approvalId);
  const convo = getRunConvo(runId);

  if (!run) return json({ error: "run not found" }, 404);
  if (!approval || approval.runId !== runId) return json({ error: "approval not found" }, 404);
  if (approval.status !== "pending") return json({ error: `approval already ${approval.status}` }, 409);
  if (!decision) return json({ error: "decision must be 'approve' or 'deny'" }, 400);
  if (!convo) return json({ error: "run context expired" }, 409);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PilotEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const step = run.steps.find((s) => s.id === approval.stepId);

      try {
        if (decision === "approve") {
          const res = await runTool(approval.toolName, approval.args, { approved: true });
          if (step) {
            step.title = `🔧 ${approval.toolName}`;
            step.status = res.ok ? "done" : "failed";
            step.endedAt = now();
            step.detail = res.output.slice(0, 160);
          }
          approval.status = "approved";
          approval.decidedAt = now();
          addAudit({ id: id("aud"), runId, ts: now(), kind: "approval.approved", detail: approval.toolName });
          addAudit({ id: id("aud"), runId, ts: now(), kind: "tool.executed", detail: `${approval.toolName} -> ${res.ok ? "ok" : "error"}` });
          convo.push({ role: "tool", content: res.output, tool_name: approval.toolName });
        } else {
          if (step) {
            step.title = `🚫 denied: ${approval.toolName}`;
            step.status = "failed";
            step.endedAt = now();
          }
          approval.status = "denied";
          approval.decidedAt = now();
          addAudit({ id: id("aud"), runId, ts: now(), kind: "approval.denied", detail: approval.toolName });
          convo.push({ role: "tool", content: "The user DENIED this action. Do not attempt it again; continue and answer without performing it.", tool_name: approval.toolName });
        }

        saveApproval(approval);
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
