export type ApiVersion = 'v1';

export interface ApiEnvelope<T> {
  version: ApiVersion;
  traceId: string;
  sentAt: string;
  payload: T;
}

export type FeatureName =
  | 'chat'
  | 'fix'
  | 'explain'
  | 'test'
  | 'commit'
  | 'review'
  | 'search';

export type ModelProfile = 'none' | 'local' | 'cheap' | 'default' | 'premium';
export type HealthStatus = 'ok' | 'starting' | 'degraded' | 'error';

export interface ProviderHealth {
  name: string;
  reachable: boolean;
  role: 'cheap' | 'default' | 'premium' | 'local';
}

export interface HealthResponse {
  status: HealthStatus;
  service: 'migrapilot-brain';
  version: string;
  uptimeSec: number;
  providers: ProviderHealth[];
  indexes: {
    repoMapReady: boolean;
    symbolIndexReady: boolean;
    embeddingsReady: boolean;
  };
}

export interface RouteRequest {
  feature: FeatureName;
  userPrompt: string;
  contextSummary?: string;
  signals?: {
    hasSelection?: boolean;
    hasDiagnostics?: boolean;
    openFileCount?: number;
    changedFileCount?: number;
  };
}

export interface RouteResponse {
  taskType: 'deterministic' | 'cheap_llm' | 'default_llm' | 'premium_llm';
  modelProfile: ModelProfile;
  retrievalMode: 'none' | 'light' | 'standard' | 'deep';
  toolPlan: string[];
  maxInputTokens: number;
  maxOutputTokens: number;
  allowEscalation: boolean;
  reason: string;
}

export interface RetrievedChunk {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  source: 'grep' | 'symbol' | 'embedding' | 'recent';
}

export interface RetrieveRequest {
  query: string;
  workspaceRoot: string;
  feature: Extract<FeatureName, 'chat' | 'fix' | 'explain' | 'test' | 'review'>;
  activeFile?: string;
  selectionText?: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxChunks?: number;
  /** Prior-conversation text (summary / recent turns). Lets a follow-up question
   * inherit the SUBJECT identifier from earlier turns (e.g. "what ops does it
   * support?" after "what does registerInspectRoutes do?") so grounding still
   * anchors on the right symbol instead of drifting to unrelated files. */
  conversationContext?: string;
}

export interface RetrieveResponse {
  repoSummary?: string;
  chunks: RetrievedChunk[];
  tokenEstimate: number;
}

export interface DiagnosticItem {
  file: string;
  code?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  startLine: number;
  endLine: number;
}

/** A user-supplied attachment forwarded with a chat turn. Images are analyzed by
 * a vision-capable model; text-like documents are inlined into the prompt by the
 * chat surface before sending. `dataBase64` is the raw base64 payload (no data:
 * URL prefix). */
export interface ChatAttachment {
  name: string;
  /** MIME type, e.g. `image/png`, `application/pdf`, `text/csv`. */
  mimeType: string;
  /** Base64-encoded file bytes, WITHOUT the `data:<mime>;base64,` prefix. */
  dataBase64: string;
  /** Byte size of the decoded file, when known (for budget/telemetry). */
  sizeBytes?: number;
}

export interface ChatTurnRequest {
  feature: Exclude<FeatureName, 'search'>;
  modelProfile: Exclude<ModelProfile, 'none'>;
  systemPromptId: string;
  userPrompt: string;
  context: {
    activeFile?: string;
    selectionText?: string;
    diagnostics?: DiagnosticItem[];
    retrievedChunks?: RetrievedChunk[];
    gitDiff?: string;
    conversationSummary?: string;
    /** User-uploaded attachments (images for vision analysis, documents, …). */
    attachments?: ChatAttachment[];
  };
  outputMode: 'markdown' | 'json_patch' | 'structured_fix';
}

export interface ProposedEdit {
  path: string;
  replacementRange: {
    startLine: number;
    endLine: number;
  };
  newText: string;
}

export interface Citation {
  path: string;
  startLine: number;
  endLine: number;
}

export interface ChatTurnResponse {
  modelProfile: Exclude<ModelProfile, 'none'>;
  content: string;
  citations?: Citation[];
  proposedEdits?: ProposedEdit[];
  telemetry: {
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    cacheHit: boolean;
  };
}

export interface BudgetCheckRequest {
  feature: string;
  modelProfile: Exclude<ModelProfile, 'none'>;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface BudgetCheckResponse {
  allowed: boolean;
  downgradedTo?: 'local' | 'cheap' | 'default';
  reason?: string;
}

export interface TelemetryEventRequest {
  traceId: string;
  feature: string;
  event:
    | 'request_started'
    | 'request_completed'
    | 'tool_called'
    | 'tool_failed'
    | 'edit_accepted'
    | 'edit_rejected'
    | 'fallback_used';
  data: Record<string, string | number | boolean | null>;
}

export type ToolName =
  | 'workspace.search'
  | 'workspace.listFiles'
  | 'file.readRange'
  | 'file.readSymbol'
  | 'file.stat'
  | 'git.status'
  | 'git.diff'
  | 'edit.preview'
  | 'edit.apply'
  | 'diagnostics.get';

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_PATH'
  | 'NOT_FOUND'
  | 'OUT_OF_RANGE'
  | 'UNSUPPORTED'
  | 'EXECUTION_FAILED'
  | 'CONFLICT';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  recoverable: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface ToolTelemetry {
  durationMs: number;
  deterministic: true;
  tokenAvoidedEstimate: number;
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface WorkspaceScopedInput {
  workspaceRoot: string;
}

export interface WorkspaceSearchRequest extends WorkspaceScopedInput {
  query: string;
  isRegexp?: boolean;
  caseSensitive?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxResults?: number;
}

export interface WorkspaceSearchMatch {
  path: string;
  lineNumber: number;
  startColumn: number;
  endColumn: number;
  preview: string;
}

export interface WorkspaceSearchResponse {
  matches: WorkspaceSearchMatch[];
  truncated: boolean;
}

export interface WorkspaceListFilesRequest extends WorkspaceScopedInput {
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxResults?: number;
}

export interface WorkspaceListFilesResponse {
  files: string[];
  truncated: boolean;
}

export interface FileScopedInput extends WorkspaceScopedInput {
  filePath: string;
}

export interface FileReadRangeRequest extends FileScopedInput, LineRange {}

export interface FileReadRangeResponse {
  path: string;
  range: LineRange;
  totalLines: number;
  content: string;
}

export interface FileReadSymbolRequest extends FileScopedInput {
  symbolName: string;
}

export interface FileReadSymbolResponse {
  path: string;
  symbolName: string;
  range: LineRange;
  content: string;
}

export interface FileStatRequest extends FileScopedInput {}

export interface FileStatResponse {
  path: string;
  exists: boolean;
  type: 'file' | 'directory' | 'missing';
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface GitStatusRequest extends WorkspaceScopedInput {}

export interface GitStatusFile {
  path: string;
  x: string;
  y: string;
  staged: boolean;
  unstaged: boolean;
}

export interface GitStatusResponse {
  branch?: string;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
}

export interface GitDiffRequest extends WorkspaceScopedInput {
  filePath?: string;
  staged?: boolean;
  maxCharacters?: number;
}

export interface GitDiffResponse {
  diff: string;
  truncated: boolean;
}

export interface EditOperation extends FileScopedInput, LineRange {
  newText: string;
}

export interface EditPreviewRequest extends WorkspaceScopedInput {
  edits: EditOperation[];
}

export interface EditPreviewFile {
  path: string;
  changed: boolean;
  diff: string;
}

export interface EditPreviewResponse {
  files: EditPreviewFile[];
}

export interface EditApplyRequest extends WorkspaceScopedInput {
  edits: EditOperation[];
}

export interface EditApplyFile {
  path: string;
  changed: boolean;
}

export interface EditApplyResponse {
  files: EditApplyFile[];
}

export interface DiagnosticsGetRequest extends WorkspaceScopedInput {
  filePath?: string;
  diagnostics?: DiagnosticItem[];
}

export interface DiagnosticsGetResponse {
  diagnostics: DiagnosticItem[];
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
}

export interface ToolInputByName {
  'workspace.search': WorkspaceSearchRequest;
  'workspace.listFiles': WorkspaceListFilesRequest;
  'file.readRange': FileReadRangeRequest;
  'file.readSymbol': FileReadSymbolRequest;
  'file.stat': FileStatRequest;
  'git.status': GitStatusRequest;
  'git.diff': GitDiffRequest;
  'edit.preview': EditPreviewRequest;
  'edit.apply': EditApplyRequest;
  'diagnostics.get': DiagnosticsGetRequest;
}

export interface ToolOutputByName {
  'workspace.search': WorkspaceSearchResponse;
  'workspace.listFiles': WorkspaceListFilesResponse;
  'file.readRange': FileReadRangeResponse;
  'file.readSymbol': FileReadSymbolResponse;
  'file.stat': FileStatResponse;
  'git.status': GitStatusResponse;
  'git.diff': GitDiffResponse;
  'edit.preview': EditPreviewResponse;
  'edit.apply': EditApplyResponse;
  'diagnostics.get': DiagnosticsGetResponse;
}

export type ToolExecutionRequest = {
  [K in ToolName]: {
    tool: K;
    input: ToolInputByName[K];
  };
}[ToolName];

export type ToolRequest<K extends ToolName> = Extract<ToolExecutionRequest, { tool: K }>;

export interface ToolSuccessResponse<K extends ToolName> {
  ok: true;
  tool: K;
  output: ToolOutputByName[K];
  telemetry: ToolTelemetry;
}

export interface ToolFailureResponse<K extends ToolName = ToolName> {
  ok: false;
  tool: K;
  error: ToolError;
  telemetry: ToolTelemetry;
}

export type ToolExecutionResponse = {
  [K in ToolName]: ToolSuccessResponse<K> | ToolFailureResponse<K>;
}[ToolName];

export type ToolResponse<K extends ToolName> = Extract<ToolExecutionResponse, { tool: K }>;

export function makeEnvelope<T>(payload: T, traceId?: string): ApiEnvelope<T> {
  return {
    version: 'v1',
    traceId: traceId ?? createTraceId(),
    sentAt: new Date().toISOString(),
    payload
  };
}

export function createTraceId(): string {
  return `mp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
