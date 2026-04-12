import type { MissionTaskGraph, PlannerInput, MissionTask, MissionLane } from "./types";
import { randomUUID } from "node:crypto";

export interface LlmPlannerAdapterResult {
  taskGraph: MissionTaskGraph;
  notes?: string[];
}

export type LlmPlannerAdapter = (plannerInput: PlannerInput) => Promise<LlmPlannerAdapterResult | null>;

// Default adapter is intentionally inert until a concrete implementation is wired.
export const stubLlmPlannerAdapter: LlmPlannerAdapter = async () => null;

/**
 * Pilot-API LLM planner adapter.
 * Sends goal + context to the pilot-api chat endpoint in "plan" mode
 * and parses the structured task graph from the response.
 */
const PILOT_API_BASE = process.env.PILOT_API_URL ?? process.env.NEXT_PUBLIC_PILOT_API_BASE_URL ?? "http://localhost:3377";

export const pilotLlmPlannerAdapter: LlmPlannerAdapter = async (input) => {
  try {
    const planPrompt = [
      `Generate a mission task graph for the following goal.`,
      `Goal: ${input.goal}`,
      input.context?.notes ? `Context: ${input.context.notes}` : "",
      `Environment: ${input.environment}`,
      ``,
      `Return ONLY a JSON object with this shape:`,
      `{ "tasks": [{ "lane": "code"|"qa"|"ops"|"docs", "title": string, "intent": string, "deps": string[], "toolCalls": [{ "toolName": string, "input": object }] }], "notes": string[] }`,
      `Available lanes: code, qa, ops, docs.`,
      `Available tools: system.health, pods.list, pods.create, pods.delete, domains.list, domains.provision, dns.lookup, dns.createRecord, dns.deleteRecord, mail.createMailbox, wordpress.deploy, storage.deleteObject, repo.search, repo.read, repo.write, git.status, git.diff, git.commit, security.scan.`,
    ].filter(Boolean).join("\n");

    const res = await fetch(`${PILOT_API_BASE}/api/pilot/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: planPrompt, model: "haiku" }),
    });

    if (!res.ok) return null;

    // Collect SSE tokens
    const text = await res.text();
    const tokens: string[] = [];
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.text) tokens.push(evt.text);
        } catch { /* skip non-JSON lines */ }
      }
    }

    const fullText = tokens.join("");
    // Extract JSON from between ```json ... ``` or raw
    const jsonMatch = fullText.match(/```json\s*([\s\S]*?)```/) ?? fullText.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[1]);
    if (!Array.isArray(parsed.tasks)) return null;

    const laneOrder: MissionLane[] = ["code", "qa", "ops", "docs"];
    const tasks: MissionTask[] = parsed.tasks.map((t: any) => ({
      taskId: `task_${randomUUID()}`,
      lane: laneOrder.includes(t.lane) ? t.lane : "ops",
      title: String(t.title || "Untitled"),
      intent: String(t.intent || ""),
      deps: Array.isArray(t.deps) ? t.deps : [],
      toolCalls: Array.isArray(t.toolCalls) ? t.toolCalls.map((tc: any) => ({
        toolName: String(tc.toolName || "system.health"),
        input: tc.input ?? {},
      })) : [],
      status: "pending" as const,
      retries: 0,
      maxRetries: 2,
      nonCritical: !!t.nonCritical,
      outputsRefs: [],
    }));

    const lanes = laneOrder.filter((lane) => tasks.some((task) => task.lane === lane));

    return {
      taskGraph: { lanes, tasks },
      notes: Array.isArray(parsed.notes) ? parsed.notes : ["LLM planner generated task graph"],
    };
  } catch {
    return null; // fall back to rule planner
  }
};
