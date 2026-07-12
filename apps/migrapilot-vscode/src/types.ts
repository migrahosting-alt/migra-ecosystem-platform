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
  /**
   * Truncation is tracked PER KIND, because the model must be told exactly what it
   * is looking at. A model that cannot distinguish "the whole file" from "the first
   * 4% of the file" will infer end-of-file corruption from a clean cut (E-CTX-01:
   * a truncated package-lock.json was reported as malformed JSON). The aggregate
   * `truncated` flag above cannot express which of the two was cut.
   */
  filePreviewTruncated: boolean;
  selectionTruncated: boolean;
  /** Full length of the document in characters (the preview may be shorter). */
  fileCharCount: number;
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
