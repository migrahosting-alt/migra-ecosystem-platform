export type ChatProvider = "auto" | "local" | "haiku" | "sonnet" | "opus";
export type ChatMode = "chat" | "plan" | "execute-t01" | "execute-t2";

export interface ChatSettings {
  provider: ChatProvider;
  model: string;
  defaultMode: ChatMode;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: "auto",
  model: "",
  defaultMode: "execute-t01",
};
