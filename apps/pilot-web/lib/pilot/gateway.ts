// MigraPilot — model gateway (Phase 6).
// Routes each agent/task to a local model (Ollama) and streams tokens.
// Provider-agnostic by design: swap MODEL_BASE / add cloud tiers later.

import type { AgentProfileId } from "./types";

const MODEL_BASE = process.env.PILOT_MODEL_BASE ?? "http://localhost:11434";

export type ToolCall = { function: { name: string; arguments: Record<string, unknown> | string } };
export type ChatMessage = { role: string; content: string; tool_calls?: ToolCall[]; tool_name?: string };

// Logical tiers -> concrete local models. Kept here so routing is one edit away.
export const MODELS = {
  primary: "gpt-oss:120b-cloud", // fast cloud 120B — best quality, ~1s latency, supports tools
  local: "llama3.1:8b", // local fallback if the cloud model is unavailable
  codeDeep: "qwen3-coder:30b", // deep local coding (slower)
  reason: "deepseek-r1:14b", // local reasoning
};

// gpt-oss:120b-cloud is fast and strong across every agent type, so route everything to it.
export function selectModel(_agentId: AgentProfileId): { model: string; tier: string } {
  return { model: MODELS.primary, tier: "cloud-120b" };
}

export async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${MODEL_BASE}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function gatewayHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${MODEL_BASE}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Single non-streamed turn — used for the tool-calling loop (returns tool_calls reliably).
export async function chatOnce(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  temperature?: number;
  signal?: AbortSignal;
}): Promise<{ content: string; toolCalls: ToolCall[]; model: string }> {
  const call = async (model: string) => {
    const res = await fetch(`${MODEL_BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        tools: opts.tools,
        stream: false,
        options: { temperature: opts.temperature ?? 0.3 },
      }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`model gateway error ${res.status} for ${model}`);
    const data = (await res.json()) as { message?: { content?: string; tool_calls?: ToolCall[] } };
    return { content: data.message?.content ?? "", toolCalls: data.message?.tool_calls ?? [], model };
  };
  try {
    return await call(opts.model);
  } catch (e) {
    // Cloud model unavailable? Fall back once to the local model.
    if (opts.model !== MODELS.local) return await call(MODELS.local);
    throw e;
  }
}

// Streams assistant token deltas from the local model.
export async function* streamChat(opts: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const res = await fetch(`${MODEL_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      options: { temperature: opts.temperature ?? 0.3 },
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`model gateway error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: { message?: { content?: string }; done?: boolean };
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const delta = obj.message?.content;
      if (delta) yield delta;
      if (obj.done) return;
    }
  }
}
