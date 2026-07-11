export type PilotMode = "ask" | "agent" | "voice" | "command";

export type ActionLevel = 0 | 1 | 2 | 3 | 4;

export interface WorkspaceContext {
  workspaceName: string;
  activeFilePath: string;
  relativeFilePath: string;
  languageId: string;
  hasSelection: boolean;
  selectionLineCount: number;
  actionLevel: ActionLevel;
  mode: PilotMode;
  fileSizeBytes: number;
  fileLineCount: number;
  filePreview: string;
  selectedTextPreview: string;
  selectedTextLength: number;
  truncated: boolean;
  warning: string;
}

export interface DraftPatchPlan {
  title: string;
  problemSummary: string;
  targetScope: string;
  filesLikelyInvolved: string[];
  proposedChanges: string[];
  riskLevel: "low" | "medium" | "high";
  manualVerificationCommands: string[];
  rollbackNotes: string[];
  safetyBoundary: string;
}

export interface DraftDiff {
  title: string;
  filePath: string;
  unifiedDiff: string;
  notes: string[];
  safetyBoundary: string;
}

export interface WebviewMessage {
  command: string;
  prompt?: string;
  context?: WorkspaceContext;
  patchPlan?: DraftPatchPlan;
  draftDiff?: DraftDiff;
}
