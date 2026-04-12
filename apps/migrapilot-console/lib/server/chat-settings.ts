import fs from "node:fs";
import path from "node:path";

import { DEFAULT_CHAT_SETTINGS, type ChatProvider, type ChatSettings } from "../shared/chat-settings";

const settingsPath = path.resolve(process.cwd(), ".data", "chat-settings.json");

function ensureFile() {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify(DEFAULT_CHAT_SETTINGS, null, 2), "utf8");
  }
}

function sanitizeProvider(value: unknown): ChatProvider {
  if (value === "local" || value === "haiku" || value === "sonnet" || value === "opus") {
    return value;
  }
  return "auto";
}

function sanitizeMode(value: unknown): ChatSettings["defaultMode"] {
  if (value === "chat" || value === "plan" || value === "execute-t01" || value === "execute-t2") {
    return value;
  }
  return DEFAULT_CHAT_SETTINGS.defaultMode;
}

function sanitizeModel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 120);
}

function sanitize(input: Partial<ChatSettings> | null | undefined): ChatSettings {
  return {
    provider: sanitizeProvider(input?.provider),
    model: sanitizeModel(input?.model),
    defaultMode: sanitizeMode(input?.defaultMode),
  };
}

export function readChatSettings(): ChatSettings {
  ensureFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Partial<ChatSettings>;
    return sanitize(parsed);
  } catch {
    return { ...DEFAULT_CHAT_SETTINGS };
  }
}

export function writeChatSettings(input: Partial<ChatSettings>): ChatSettings {
  ensureFile();
  const merged = sanitize({ ...readChatSettings(), ...input });
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
