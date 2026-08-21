/**
 * The closed set of Brain operations this application may perform.
 *
 * The gateway takes an operation from this union — never a path. That is what
 * makes arbitrary proxying structurally impossible: there is no code path from
 * a browser-supplied string to a Brain URL.
 *
 * Governed coding is deliberately READ-ONLY here. Phase 1's product decision is
 * that the browser observes durable runs started by an authorized,
 * workspace-bearing surface (the VS Code extension). `POST /coding/runs`,
 * `/scope-decision` and `/cancel` are therefore absent by design — a browser
 * has no `workspaceRoot`, and inventing one would weaken the filesystem
 * governance contract.
 */

export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Evidence-source modes the Brain ENFORCES (`packages/protocol/src/grounding.ts`).
 *
 * Only two are meaningful to this app, and the difference is the whole Files
 * feature:
 *
 *   approved  the caller's approved semantic index only — REFUSE rather than
 *             answer without it. This is what makes "ask about my documents"
 *             truthful: no evidence means no answer, not a confident guess.
 *   none      no document evidence at all, for ordinary chat.
 *
 * `auto` is deliberately NOT used. It prefers approved evidence and silently
 * falls back when retrieval returns nothing — which on a consumer server with no
 * checkout means falling back to nothing, leaving the model to answer from its
 * own priors. Asked to summarise an uploaded `migration-notes.md`, it invented a
 * document: `user_sessions` tables, a Stripe v3 migration, Amplitude webhooks,
 * `scripts/migrate_data.py`. None of it existed. That answer was persisted.
 */
export type GroundingMode = 'approved' | 'none'

export type BrainOperation =
  // ── conversations ────────────────────────────────────────────────────────
  | { kind: 'listConversations' }
  | { kind: 'createConversation'; title?: string; memoryMode?: 'off' | 'session' | 'durable' }
  | { kind: 'getConversation'; conversationId: string }
  | { kind: 'renameConversation'; conversationId: string; title: string }
  | { kind: 'deleteConversation'; conversationId: string }
  | { kind: 'listMessages'; conversationId: string }
  | { kind: 'appendMessage'; conversationId: string; role: MessageRole; content: string }
  // ── turns ────────────────────────────────────────────────────────────────
  | {
      kind: 'chatTurn'
      prompt: string
      conversationSummary?: string
      stream?: boolean
      /** Which evidence the Brain may ground on. See GROUNDING_MODES below. */
      groundingMode?: GroundingMode
    }
  | { kind: 'answer'; prompt: string; tier?: 'local' | 'cloud' }
  // ── document indexes (the Files library) ─────────────────────────────────
  | { kind: 'listIndexes' }
  | { kind: 'createDocsIndex'; root: string }
  | { kind: 'syncIndex'; indexId: string }
  | { kind: 'indexStatus'; indexId: string }
  | { kind: 'approveIndex'; indexId: string }
  // ── governed coding (observation only) ───────────────────────────────────
  | { kind: 'codingCapability' }
  | { kind: 'getCodingRun'; runId: string }

  // ── Speech ──────────────────────────────────────────────────────────────
  | { kind: 'transcriptionCapability' }
  /**
   * `requestedLanguage` is present ONLY when the user explicitly chose one.
   *
   * It must never be populated with a runtime default. The ASR worker pins "en" for an
   * English-only model by itself, and when that pin was reported as the caller's request it
   * disabled the fabrication guard: French audio came back status "ok", no warnings, fluent
   * invented English, ready to send as the speaker's own words. A runtime choice must not
   * masquerade as something the user asked for — so the field is optional and never
   * defaulted anywhere along this path.
   */
  | { kind: 'transcribe'; audioBase64: string; audioMime: string; requestedLanguage?: string }

export interface ResolvedRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}

/**
 * Path segments are validated, not escaped-and-hoped. A conversation or run id
 * containing `/`, `..`, or a query character would otherwise let a caller reach
 * a different Brain route through an id field.
 */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/

export class InvalidOperationError extends Error {
  readonly code = 'INVALID_OPERATION'
  constructor(message: string) {
    super(message)
    this.name = 'InvalidOperationError'
  }
}

function id(value: string, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new InvalidOperationError(`${label} is not a valid identifier.`)
  }
  return value
}

/** Audio is bounded here, not just at the Brain: an unbounded base64 body is a denial of
 *  service the consumer can refuse to send in the first place. */
const MAX_AUDIO_BASE64 = 34 * 1024 * 1024 // ~25 MB of bytes once decoded

function boundedAudio(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidOperationError('audio must be a non-empty base64 string.')
  }
  if (value.length > MAX_AUDIO_BASE64) {
    throw new InvalidOperationError('audio is too large to transcribe.')
  }
  return value
}

const AUDIO_MIME = /^audio\/[A-Za-z0-9.+-]{1,64}$/

function audioMime(value: string): string {
  if (typeof value !== 'string' || !AUDIO_MIME.test(value)) {
    throw new InvalidOperationError('audioMime must be an audio/* media type.')
  }
  return value
}

/** BCP-47-ish. Validated so a language field cannot become a path or a payload. */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,8})?$/

function languageCode(value: string): string {
  if (typeof value !== 'string' || !LANGUAGE_CODE.test(value)) {
    throw new InvalidOperationError('requestedLanguage is not a valid language code.')
  }
  return value
}

/**
 * An absolute path beneath the upload root.
 *
 * This is the only operation that carries a filesystem path, so it is bounded
 * here as well as at the call site: anything relative, containing `..`, or
 * outside the configured root is refused rather than forwarded to the Brain.
 */
function absolutePath(value: string, label: string): string {
  const root = process.env.UPLOAD_ROOT ?? '/var/lib/migrapilot/uploads'
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('..')) {
    throw new InvalidOperationError(`${label} must be an absolute path with no parent segments.`)
  }
  if (value !== root && !value.startsWith(`${root}/`)) {
    throw new InvalidOperationError(`${label} must sit under the upload root.`)
  }
  return value
}

function text(value: string, label: string, max = 32_000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidOperationError(`${label} must be a non-empty string.`)
  }
  if (value.length > max) throw new InvalidOperationError(`${label} exceeds ${max} characters.`)
  return value
}

/** Map an operation to a concrete Brain request. The only path constructor. */
export function resolveOperation(op: BrainOperation): ResolvedRequest {
  switch (op.kind) {
    case 'listConversations':
      return { method: 'GET', path: '/api/ai/conversations' }

    case 'createConversation':
      return {
        method: 'POST',
        path: '/api/ai/conversations',
        // Durable by default: the consumer's whole point is reload persistence.
        body: { title: op.title, memoryMode: op.memoryMode ?? 'durable' },
      }

    case 'getConversation':
      return { method: 'GET', path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}` }

    case 'renameConversation':
      return {
        method: 'PATCH',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}`,
        body: { title: text(op.title, 'title', 400) },
      }

    case 'deleteConversation':
      return {
        method: 'DELETE',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}`,
      }

    case 'listMessages':
      return {
        method: 'GET',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}/messages`,
      }

    case 'appendMessage':
      return {
        method: 'POST',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}/messages`,
        body: { role: op.role, content: text(op.content, 'content') },
      }

    case 'chatTurn':
      return {
        method: 'POST',
        path: '/api/ai/chat',
        body: {
          prompt: text(op.prompt, 'prompt'),
          ...(op.conversationSummary ? { conversationSummary: op.conversationSummary } : {}),
          // The Brain streams SSE when this is truthy and buffers otherwise.
          ...(op.stream ? { stream: true } : {}),
          // Always explicit. Omitting it defaults the Brain to `auto`, which is
          // the mode that let an ungrounded answer through.
          groundingMode: op.groundingMode ?? 'none',
        },
      }

    case 'answer':
      return {
        method: 'POST',
        path: '/api/ai/answer',
        // `workspaceRoot` is deliberately never sent: the consumer server has no
        // workspace, and asserting one would be a fiction.
        body: { prompt: text(op.prompt, 'prompt'), tier: op.tier ?? 'local' },
      }

    case 'listIndexes':
      return { method: 'GET', path: '/api/ai/indexes' }

    case 'createDocsIndex':
      // `root` is a path, which is exactly the thing this module exists to keep
      // out of a caller's hands — so it is validated as an absolute path under
      // the upload root and never reaches here from a request body. See
      // `src/server/files/storage.ts` for where it is derived from the session.
      return {
        method: 'POST',
        path: '/api/ai/indexes',
        body: { sourceType: 'docs', root: absolutePath(op.root, 'root') },
      }

    case 'syncIndex':
      return { method: 'POST', path: `/api/ai/indexes/${id(op.indexId, 'indexId')}/sync` }

    case 'indexStatus':
      return { method: 'GET', path: `/api/ai/indexes/${id(op.indexId, 'indexId')}/status` }

    case 'approveIndex':
      // Promotion to `approved` is what makes an index eligible for grounding:
      // `approvedIndexFor` ignores any index without an approved version. The
      // index being promoted is always the caller's own — see the root check in
      // `createDocsIndex` and the lookup in `app/api/files/index/route.ts`.
      return {
        method: 'PATCH',
        path: `/api/ai/indexes/${id(op.indexId, 'indexId')}`,
        body: { state: 'approved' },
      }

    case 'codingCapability':
      return { method: 'GET', path: '/api/ai/coding/capability' }

    case 'getCodingRun':
      return { method: 'GET', path: `/api/ai/coding/runs/${id(op.runId, 'runId')}` }

    case 'transcriptionCapability':
      return { method: 'GET', path: '/api/ai/speech/capability' }

    case 'transcribe':
      return {
        method: 'POST',
        path: '/api/ai/speech/transcribe',
        body: {
          audio: boundedAudio(op.audioBase64),
          mime: audioMime(op.audioMime),
          // Omitted entirely when the user chose nothing. Not null, not "en".
          ...(op.requestedLanguage ? { requestedLanguage: languageCode(op.requestedLanguage) } : {}),
        },
      }
  }

  // Unreachable for well-typed callers. Reached at runtime only if an
  // unrecognised operation arrives — which must fail closed here rather than
  // return `undefined` and surface later as a confusing TypeError.
  throw new InvalidOperationError(
    `Unknown Brain operation: ${String((op as { kind?: unknown }).kind)}`,
  )
}
