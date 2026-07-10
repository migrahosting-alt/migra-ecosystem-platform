export type PilotMode = "ask" | "agent" | "voice" | "command";

export type ActionLevel = 0 | 1 | 2 | 3 | 4;

export interface WorkspaceContext {
  workspaceName: string;
  activeFilePath: string;
  languageId: string;
  hasSelection: boolean;
  selectionLineCount: number;
  actionLevel: ActionLevel;
  mode: PilotMode;
}

export interface WebviewMessage {
  command: string;
  prompt?: string;
  context?: WorkspaceContext;
}
