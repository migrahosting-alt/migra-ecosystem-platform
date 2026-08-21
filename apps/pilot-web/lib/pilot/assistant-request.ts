import type { ChatMessage } from "./gateway";

export type AssistantHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantRequestBody = {
  message?: unknown;
  history?: unknown;
};

export function parseAssistantRequestBody(body: AssistantRequestBody): {
  message: string;
  history: AssistantHistoryItem[];
} {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory
    .map((item): AssistantHistoryItem | null => {
      if (!item || typeof item !== "object") return null;
      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
      const trimmed = content.trim();
      return trimmed ? { role, content: trimmed } : null;
    })
    .filter((item): item is AssistantHistoryItem => Boolean(item))
    .slice(-8);
  return { message, history };
}

export function appendAssistantHistory(messages: ChatMessage[], history: AssistantHistoryItem[]): void {
  for (const item of history) messages.push({ role: item.role, content: item.content });
}
