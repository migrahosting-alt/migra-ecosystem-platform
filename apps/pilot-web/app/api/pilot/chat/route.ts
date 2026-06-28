// POST /api/pilot/chat — Phase 8.
// Classifies intent, routes to a local model, runs the agentic tool loop, and
// streams events (NDJSON). Read tools auto-run; mutating tools PAUSE the run for
// human approval (resumed via /api/pilot/runs/:id/approve).

import { AGENT_PROFILES, classifyAgent, buildSystemPrompt } from "../../../../lib/pilot/agent";
import { selectModel, type ChatMessage } from "../../../../lib/pilot/gateway";
import { streamPilotRun } from "../../../../lib/pilot/orchestrator";
import { retrieveContext } from "../../../../lib/pilot/knowledge";
import { getOrCreateConversation, id, saveMessage, saveRun, store } from "../../../../lib/pilot/store";
import type { Message, PilotEvent, Run } from "../../../../lib/pilot/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const now = () => new Date().toISOString();
const HISTORY_LIMIT = 10;

export async function POST(req: Request) {
  let body: { message?: unknown; mode?: unknown; conversationId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const mode = typeof body.mode === "string" && body.mode ? body.mode : "Plan";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;

  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const conversation = getOrCreateConversation(conversationId);
  const agentId = classifyAgent(message);
  const profile = AGENT_PROFILES[agentId];
  const { model, tier } = selectModel(agentId);

  const userMessage: Message = { id: id("msg"), role: "user", content: message, createdAt: now() };
  saveMessage(userMessage);
  conversation.messageIds.push(userMessage.id);

  const stepTitles = ["Understand request", `Select model (${model})`, "Generate response"];
  const run: Run = {
    id: id("run"),
    conversationId: conversation.id,
    agentProfileId: agentId,
    agentName: profile.name,
    mode,
    status: "running",
    userMessage: message,
    model,
    tier,
    steps: stepTitles.map((title, index) => ({ id: id("step"), index, title, status: "pending", startedAt: "" })),
    createdAt: now(),
  };
  saveRun(run);
  conversation.runIds.push(run.id);

  const history: ChatMessage[] = conversation.messageIds
    .map((mid) => store.messages.get(mid))
    .filter((m): m is Message => Boolean(m))
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }));

  const convo: ChatMessage[] = [{ role: "system", content: buildSystemPrompt(agentId) }, ...history];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PilotEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const setStep = (index: number, status: "running" | "done") => {
        const step = run.steps[index];
        step.status = status;
        if (status === "running" && !step.startedAt) step.startedAt = now();
        if (status === "done") step.endedAt = now();
        saveRun(run);
        send({ type: "step", step });
      };

      try {
        send({ type: "run.created", run });
        setStep(0, "running"); setStep(0, "done");
        setStep(1, "running"); setStep(1, "done");
        setStep(2, "running");
        // Auto-retrieval (RAG): inject confident knowledge matches as a system message before the loop.
        const memory = await retrieveContext(message).catch(() => null);
        if (memory && memory.sources.length > 0) {
          convo.splice(1, 0, { role: "system", content: memory.text });
          run.recalled = { count: memory.sources.length, sources: memory.sources };
          const memStep = {
            id: id("step"),
            index: run.steps.length,
            title: `🧠 Recalled ${memory.sources.length} source(s) from memory`,
            status: "done" as const,
            startedAt: now(),
            endedAt: now(),
          };
          run.steps.push(memStep);
          saveRun(run);
          send({ type: "step", step: memStep });
        }
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
