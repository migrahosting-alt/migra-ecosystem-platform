// POST /api/pilot/assistant/abigail — Abigail / MigraHosting READ-ONLY text assistant.
//
// Bearer-auth (MIGRAPILOT_ABIGAIL_ASSISTANT_SECRET; 401 otherwise). Runs a SINGLE model completion
// with NO tools offered to the model, so it can invoke nothing. It never touches the orchestrator /
// tool loop, never calls runTool, never emits an approval card, and never runs any executor /
// mutation. Output passes through safeJson (defense-in-depth redaction).

import { checkAssistantAuthForEnv, unauthorizedResponse } from "../../../../../lib/pilot/assistant-auth";
import { buildAssistantSystemPrompt, getAssistantConfig } from "../../../../../lib/pilot/assistant-config";
import { appendAssistantHistory, parseAssistantRequestBody } from "../../../../../lib/pilot/assistant-request";
import { chatOnce, MODELS, type ChatMessage } from "../../../../../lib/pilot/gateway";
import { retrieveContext } from "../../../../../lib/pilot/knowledge";
import { safeJson } from "../../../../../lib/pilot/safe-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!checkAssistantAuthForEnv(req, "MIGRAPILOT_ABIGAIL_ASSISTANT_SECRET").ok) return unauthorizedResponse();

  let body: { message?: unknown; history?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // validated below
  }
  const { message, history } = parseAssistantRequestBody(body);
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const assistantConfig = getAssistantConfig("MIGRAPILOT_ABIGAIL_ASSISTANT_");
  const messages: ChatMessage[] = [{ role: "system", content: buildAssistantSystemPrompt(assistantConfig) }];
  const memory = await retrieveContext(message).catch(() => null);
  if (memory && memory.sources.length > 0) messages.push({ role: "system", content: memory.text });
  appendAssistantHistory(messages, history);
  messages.push({ role: "user", content: message });

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
    assistantName: assistantConfig.assistantName,
    embeddedPlatform: assistantConfig.embeddedPlatform,
    toolsExecuted: false,
    approvalCardsEmitted: false,
    executor: "absent",
    model,
    recalledSources: memory?.sources?.length ?? 0,
  });
}
