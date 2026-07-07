// POST /api/pilot/assistant — AnnouPale-safe READ-ONLY text assistant (P1 + P2).
//
// Bearer-auth (MIGRAPILOT_ASSISTANT_SECRET; 401 otherwise). Runs a SINGLE model completion with NO
// tools offered to the model, so it can invoke nothing. It never touches the orchestrator/tool loop,
// never calls runTool, never emits an approval card, and never runs any executor / noop / marker /
// webhook / mutation. Preview-only text. Distinct from /api/pilot/chat (the operator command-center
// route), which is left unchanged. Output passes through safeJson (defense-in-depth redaction).

import { checkAssistantAuth, unauthorizedResponse } from "../../../../lib/pilot/assistant-auth";
import { chatOnce, MODELS, type ChatMessage } from "../../../../lib/pilot/gateway";
import { retrieveContext } from "../../../../lib/pilot/knowledge";
import { safeJson } from "../../../../lib/pilot/safe-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ASSISTANT_SYSTEM = [
  "You are the MigraTeck / MigraHosting help assistant embedded in AnnouPale.",
  "Answer concisely and helpfully in plain text (no markdown headers).",
  "You are STRICTLY READ-ONLY: you cannot run tools, take actions, provision, deploy, restart, or change anything, and you have no ability to do so here. Never claim to have performed an action.",
  "If the user asks you to DO something, explain the steps they (or an operator) would take instead.",
  "Never reveal secrets, credentials, tokens, or internal infrastructure details.",
].join(" ");

export async function POST(req: Request) {
  if (!checkAssistantAuth(req).ok) return unauthorizedResponse();

  let body: { message?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // validated below
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const messages: ChatMessage[] = [{ role: "system", content: ASSISTANT_SYSTEM }];
  // Read-only RAG (memory recall) — reads the knowledge base; runs no tools.
  const memory = await retrieveContext(message).catch(() => null);
  if (memory && memory.sources.length > 0) messages.push({ role: "system", content: memory.text });
  messages.push({ role: "user", content: message });

  // Single completion, NO `tools` offered → the model cannot request any tool. Any hallucinated
  // tool_calls in the response are IGNORED: nothing is ever dispatched to runTool / the orchestrator.
  let reply = "";
  let model = MODELS.primary;
  try {
    const out = await chatOnce({ model: MODELS.primary, messages, temperature: 0.2 });
    reply = out.content;
    model = out.model;
  } catch {
    return new Response(JSON.stringify({ error: "assistant model unavailable", mode: "assistant_safe_read" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  return safeJson({
    reply,
    mode: "assistant_safe_read",
    toolsExecuted: false,
    approvalCardsEmitted: false,
    executor: "absent",
    model,
    recalledSources: memory?.sources?.length ?? 0,
  });
}
