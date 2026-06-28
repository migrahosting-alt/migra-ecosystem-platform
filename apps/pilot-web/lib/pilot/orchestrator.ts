// MigraPilot — orchestrator (Phase 8). Shared by /chat and /approve.
// Runs the tool-calling loop; read tools auto-run, mutating tools PAUSE the run
// for human approval. streamPilotRun() finalizes (stream answer) or pauses.

import { chatOnce, type ChatMessage, type ToolCall } from "./gateway";
import { KNOWN_TOOL_NAMES, runTool, toolSpecsForModel } from "./tools";
import { classifyPilotAction } from "./policy";
import { addAudit, id, saveApproval, saveMessage, saveRun, setRunConvo, store } from "./store";
import type { ApprovalRequest, Message, PilotEvent, Run, RunStep } from "./types";

const now = () => new Date().toISOString();
const MAX_ITERS = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
function chunkText(s: string): string[] {
  return s.match(/\S+\s*/g) ?? [s];
}
function argsOf(tc: ToolCall): Record<string, unknown> {
  return typeof tc.function.arguments === "string" ? safeParse(tc.function.arguments) : (tc.function.arguments ?? {});
}
// Recover a tool call that a model emitted as plain-text JSON instead of structured tool_calls.
function extractTextToolCall(content: string): ToolCall | null {
  const trimmed = (content || "").trim();
  if (!trimmed.includes("{")) return null;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const candidates = [trimmed];
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as { name?: string; tool?: string; arguments?: unknown; parameters?: unknown; function?: { name?: string; arguments?: unknown } };
      const name = obj.name ?? obj.tool ?? obj.function?.name;
      if (typeof name === "string" && KNOWN_TOOL_NAMES.has(name)) {
        const a = obj.arguments ?? obj.parameters ?? obj.function?.arguments ?? {};
        return { function: { name, arguments: (a && typeof a === "object" ? a : {}) as Record<string, unknown> } };
      }
    } catch {
      // not JSON
    }
  }
  return null;
}

export type LoopResult =
  | { status: "done"; assistantText: string }
  | { status: "paused"; approval: ApprovalRequest };

// Runs the model/tool loop until a final answer or a mutating-tool pause.
export async function runAgentLoop(run: Run, convo: ChatMessage[], send: (e: PilotEvent) => void): Promise<LoopResult> {
  const model = run.model ?? "llama3.1:8b";
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const turn = await chatOnce({ model, messages: convo, tools: toolSpecsForModel() });
    let toolCalls = turn.toolCalls;
    if (toolCalls.length === 0) {
      const recovered = extractTextToolCall(turn.content);
      if (recovered) toolCalls = [recovered];
    }
    if (toolCalls.length === 0) {
      return { status: "done", assistantText: turn.content };
    }

    const assistantMsg: ChatMessage = { role: "assistant", content: turn.content ?? "", tool_calls: [] };
    convo.push(assistantMsg);

    for (const tc of toolCalls) {
      const name = tc.function.name;
      const args = argsOf(tc);
      assistantMsg.tool_calls!.push(tc);

      const decision = classifyPilotAction(name, args);

      if (decision.blocked) {
        // REFUSE — never execute, never offer approval. Tell the model and move on.
        const step: RunStep = { id: id("step"), index: run.steps.length, title: `🚫 blocked: ${name}`, status: "failed", startedAt: now(), endedAt: now(), detail: decision.reason };
        run.steps.push(step);
        saveRun(run);
        send({ type: "step", step });
        addAudit({ id: id("aud"), runId: run.id, ts: now(), kind: "action.blocked", detail: `${name}: ${decision.reason}` });
        convo.push({ role: "tool", content: `BLOCKED: ${decision.reason}. This action is not permitted; do not attempt it again.`, tool_name: name });
        continue;
      }

      if (decision.requiresApproval) {
        // PAUSE — surface for human approval; do not execute.
        const step: RunStep = { id: id("step"), index: run.steps.length, title: `⏸ approval: ${name}`, status: "running", startedAt: now() };
        run.steps.push(step);
        const approval: ApprovalRequest = {
          id: id("apr"), runId: run.id, stepId: step.id, toolName: name, args,
          risk: decision.risk, reason: decision.reason, summary: decision.summary, expectedEffect: decision.expectedEffect,
          status: "pending", createdAt: now(),
        };
        saveRun(run);
        send({ type: "step", step });
        addAudit({ id: id("aud"), runId: run.id, ts: now(), kind: "approval.requested", detail: `${name} [${decision.risk}] ${JSON.stringify(args)}` });
        return { status: "paused", approval };
      }

      // safe_read: auto-run
      const step: RunStep = { id: id("step"), index: run.steps.length, title: `🔧 ${name}`, status: "running", startedAt: now() };
      run.steps.push(step);
      saveRun(run);
      send({ type: "step", step });

      const res = await runTool(name, args);
      step.status = res.ok ? "done" : "failed";
      step.endedAt = now();
      step.detail = res.output.slice(0, 160);
      saveRun(run);
      send({ type: "step", step });
      addAudit({ id: id("aud"), runId: run.id, ts: now(), kind: "tool.read", detail: `${name} -> ${res.ok ? "ok" : "error"}` });
      convo.push({ role: "tool", content: res.output, tool_name: name });
    }
  }
  return { status: "done", assistantText: "(The agent stopped after its tool budget without a final answer.)" };
}

// Runs the loop and either streams the final answer + finalizes the run, or pauses for approval.
export async function streamPilotRun(run: Run, convo: ChatMessage[], send: (e: PilotEvent) => void): Promise<void> {
  const result = await runAgentLoop(run, convo, send);

  if (result.status === "paused") {
    setRunConvo(run.id, convo);
    saveApproval(result.approval);
    run.status = "needs_approval";
    run.pendingApprovalId = result.approval.id;
    saveRun(run);
    send({ type: "approval.required", approval: result.approval });
    return;
  }

  const text = result.assistantText.trim() || "(empty response)";
  for (const chunk of chunkText(text)) {
    send({ type: "token", delta: chunk });
    await sleep(8); // light typing-stream feel
  }

  const gen = run.steps.find((s) => s.title === "Generate response");
  if (gen && gen.status !== "done") {
    gen.status = "done";
    gen.endedAt = now();
  }

  const assistantMessage: Message = { id: id("msg"), role: "assistant", content: text, createdAt: now() };
  saveMessage(assistantMessage);
  store.conversations.get(run.conversationId)?.messageIds.push(assistantMessage.id);
  send({ type: "message", message: assistantMessage });

  run.status = "succeeded";
  run.summary = text;
  run.pendingApprovalId = undefined;
  run.endedAt = now();
  saveRun(run);
  send({ type: "run.completed", run });
}
