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

export type EngineeringTaskStage =
  | 'inspect'
  | 'plan'
  | 'proposal'
  | 'awaiting_approval'
  | 'applying'
  | 'testing'
  | 'repair_needed'
  | 'verified'
  | 'failed'
  | 'cancelled';

export interface EngineeringTask {
  /** Brain-owned durable correlation/task identity. */
  taskId: string;
  workspaceRoot: string;
  branch?: string;
  headSha?: string;
  stage: EngineeringTaskStage;
  checkpoint: string;
  observedFiles: string[];
  evidence: Array<{ path: string; startLine?: number; endLine?: number; summary: string }>;
  proposal?: {
    proposalHash: string;
    approvalState: 'pending' | 'approved' | 'rejected' | 'applied' | 'stale';
    operations: Array<{ path: string; operation: string; before?: string | null; after?: string | null; rationale?: string }>;
    expectedVerification: string[];
  };
  commands: Array<{ argv: string[]; exitCode?: number | null; outputHead?: string; status: 'planned' | 'running' | 'passed' | 'failed' }>;
  repairAttempts: number;
  finalEvidence?: string[];
  completion: 'in_progress' | 'blocked' | 'complete' | 'failed';
}

export interface ProviderHealth {
  name: string;
  /**
   * The endpoint answered. NOT "it can generate" — see `kind`.
   *
   * These were conflated, and the conflation was invisible: a deterministic
   * stub reported reachable and the service reported `ok` while nothing could
   * produce a token.
   */
  reachable: boolean;
  role: 'cheap' | 'default' | 'premium' | 'local';
  /**
   * Whether this profile is backed by a real inference endpoint (`live`) or by
   * the deterministic placeholder (`stub`).
   *
   * Optional so an older Brain deserialises unchanged; absent means "not
   * reported", which a reader must not read as `live`.
   */
  kind?: 'live' | 'stub';
  /** Safe, secret-free reason, when there is one worth showing an operator. */
  detail?: string;
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

/**
 * A document supplied IN FULL, because it fit the turn's document budget.
 *
 * 🚨 DISTINCT FROM `RetrievedChunk` ON PURPOSE. A passage and a whole document
 * licence different answers: "the deck does not mention pricing" is sound from a
 * document read whole and is a fabrication from six passages out of seventy-four.
 * Collapsing them into one list would erase exactly the distinction that a model
 * needs in order to say which it is doing.
 */
export interface WholeDocument {
  path: string;
  /** The complete extracted text, as indexed. */
  text: string;
  /**
   * False when extraction could not read part of it.
   *
   * A deck whose charts cannot be read is NOT a document read whole, and saying
   * so is the difference between a limit disclosed and a limit hidden.
   */
  complete: boolean;
  /** Why it is incomplete, in words a user can be shown. Never jargon. */
  incompleteReason?: string;
}

/**
 * How much of a SAMPLED document this turn actually received.
 *
 * 🚨 THE FACT WHOSE ABSENCE CAUSED A FALSE ANSWER. `hybridRetriever` counted the
 * passages it dropped and the count was discarded before it reached a prompt, so
 * a model given 6 of a document's 74 passages had no way to know it held a
 * sample. It then reported, truthfully about its context and falsely about the
 * document, that it "couldn't find any content for slides before 11 or after 29".
 *
 * Carrying this is what lets an answer separate "not in this document" from "not
 * in the part I was given".
 */
export interface RetrievalCoverage {
  path: string;
  passagesProvided: number;
  /**
   * Passages this document holds in the index that answers are served from.
   *
   * 🚨 THE DOCUMENT'S TOTAL, NOT "CANDIDATES DROPPED FOR BUDGET". The first
   * version of this used the retriever's `omittedForBudget`, which counts how
   * many already-matching candidates missed the budget — a different quantity,
   * and one that is ZERO whenever the search returned few candidates. A model
   * given 6 of a deck's 74 passages would then have been told nothing at all,
   * and would have gone on reporting content as absent from the document. What
   * licenses the "do not claim absence" instruction is how much of the DOCUMENT
   * went unseen, so that is what travels.
   */
  passagesTotal: number;
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
    /** Documents small enough to be read rather than sampled. */
    wholeDocuments?: WholeDocument[];
    /** For documents that had to be sampled: how much of each was supplied. */
    retrievalCoverage?: RetrievalCoverage[];
    gitDiff?: string;
    conversationSummary?: string;
    /** User-uploaded attachments (images for vision analysis, documents, …). */
    attachments?: ChatAttachment[];
    /**
     * How this user has asked for replies to be written.
     *
     * Already reduced to DIRECTIVES rather than carrying the raw preference
     * document: the model needs the instruction, not the settings object, and
     * every field that travels here is a field that can end up in a prompt.
     * Empty or absent means the user changed nothing, and nothing is added.
     */
    responseDirectives?: string[];
  };
  outputMode: 'markdown' | 'json_patch' | 'structured_fix';
  /**
   * How much hidden deliberation this turn is worth.
   *
   * MEASURED, NOT A PREFERENCE. `qwen3` is a reasoning model: asked to "reply
   * with exactly the word: rendered" it emitted 718 characters of internal
   * monologue before the 8 characters of answer, and the turn took 26.6s. The
   * same prompt with deliberation off answered identically in 0.81s — 33x
   * faster, same words. Every ordinary chat turn was paying that.
   *
   * `'none'` is therefore the default for chat. It is NOT a quality trade for
   * the turns that need thinking: a turn routed as reasoning keeps it.
   */
  reasoning?: 'none' | 'default';
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
