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

import type { TurnAttachment } from './attachments'

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
  /**
   * Replace the files this conversation answers from.
   *
   * The WHOLE set is sent, never a delta: a retry or a race must not be able to
   * leave a thread grounded in something nobody chose.
   */
  | { kind: 'setConversationGrounding'; conversationId: string; files: string[] }
  /** The images a thread is about. Refs only; bytes never persist. */
  | { kind: 'setConversationImages'; conversationId: string; images: string[] }
  | { kind: 'appendMessage'; conversationId: string; role: MessageRole; content: string; imageRefs?: string[]; fileRefs?: string[] }
  // ── turns ────────────────────────────────────────────────────────────────
  | {
      kind: 'chatTurn'
      prompt: string
      conversationSummary?: string
      stream?: boolean
      /** Which evidence the Brain may ground on. See GROUNDING_MODES below. */
      groundingMode?: GroundingMode
      /**
       * Opaque attachment refs, in the order the user chose.
       *
       * A LIST FROM THE START even though one image is all that is accepted
       * today: "one image" baked into the transport becomes a breaking change
       * across the consumer, the contract, the Brain and every persisted turn
       * the moment someone attaches two. See `server/brain/attachments.ts`.
       */
      attachments?: readonly TurnAttachment[]
      /**
       * Images RESOLVED to bytes by the consumer, in the order the user attached
       * them.
       *
       * Distinct from `attachments` above, which is the opaque-ref form for a
       * future where the Brain resolves refs itself. Today the consumer owns the
       * store, the ownership check and the hash verification, so it resolves and
       * sends bytes — and the browser still only ever sends `img_*`.
       */
      imageAttachments?: readonly {
        name: string
        mimeType: string
        dataBase64: string
        sizeBytes?: number
      }[]
      /**
       * Restrict retrieval to these files. A BOUNDARY, not a hint.
       *
       * This field was missing once, and the omission was invisible: the route spread
       * `groundingFiles` into the call, excess-property checks do not apply through a
       * spread, so it compiled, the tests passed, and `resolveOperation` silently dropped
       * it while building the body. Retrieval kept ranking across the whole library and a
       * grounded conversation still could not find its own attached file.
       */
      groundingFiles?: string[]
    }
  | { kind: 'answer'; prompt: string; tier?: 'local' | 'cloud' }
  // ── document indexes (the Files library) ─────────────────────────────────
  | { kind: 'listIndexes' }
  /**
   * Whether an image turn could actually be answered right now.
   *
   * Asked of the BRAIN rather than assumed by this app: the vision registry is
   * fail-closed — models are installed but unusable until qualified — so
   * "an image uploaded" and "an image can be understood" are different facts and
   * only the Brain knows the second one.
   */
  | { kind: 'visionCapability' }
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

  // ── MigraPilot preferences ───────────────────────────────────────────────
  /**
   * The caller's own preferences. Identity is NOT here — MigraAuth owns name,
   * email, avatar, providers and sessions, and a second copy would drift.
   */
  | { kind: 'getPreferences' }
  /**
   * A PARTIAL update. Only the keys present are touched, so a screen that knows
   * about three preferences cannot blank the twelve it has never heard of.
   */
  | { kind: 'patchPreferences'; patch: Record<string, unknown> }
  /** When audited preferences last changed. Keys only, never values. */
  | { kind: 'preferenceEvents' }

  // ── anonymous allowance (signed-out visitors) ────────────────────────────
  /**
   * The visitor's remaining turns.
   *
   * A RENDER-TIME projection, never the authority for whether a turn may run.
   * `reserveAnonymousTurn` is the authority, because only it decides inside the
   * transaction that also records the spend.
   */
  | { kind: 'anonymousQuota' }
  /**
   * Take one turn's allowance BEFORE the model is asked anything.
   *
   * The reservation id is minted by the caller so a retried POST settles the
   * reservation it actually took rather than a second one.
   */
  | { kind: 'reserveAnonymousTurn'; reservationId: string; conversationId?: string }
  /**
   * Close a reservation. `producedOutput` is the pivot, not the HTTP status: a
   * stream that delivered tokens and then failed to persist DID give the user
   * something; a 200 carrying an empty answer did not.
   */
  | {
      kind: 'settleAnonymousTurn'
      reservationId: string
      producedOutput: boolean
      failure?: string
    }
  /**
   * Move an anonymous conversation into the account that just signed in.
   *
   * Deliberately NOT anonymous-reachable: it is made AS the account, and the
   * anonymous side is named in the body. Both halves are derived from one
   * verified cookie, and the pair is re-checked by the Brain.
   */
  | {
      kind: 'claimAnonymousConversation'
      conversationId: string
      anonymousSessionId: string
      anonymousOwner: string
    }

export interface ResolvedRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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

/** A library filename, not a path: no separators, no traversal, bounded. */
function filename(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw new InvalidOperationError('a grounding entry must be a non-empty filename.')
  }
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new InvalidOperationError('a grounding entry must be a bare filename.')
  }
  return value
}

/**
 * The anonymous session id alphabet, kept identical to the one
 * `tenancy/anonymousIdentity.ts` mints. A wider pattern here would let a value
 * this app never issued be presented as an anonymous identity.
 */
const ANON_SESSION_ID = /^[A-Za-z0-9_-]{22,64}$/

function anonymousSessionId(value: string): string {
  if (typeof value !== 'string' || !ANON_SESSION_ID.test(value)) {
    throw new InvalidOperationError('anonymousSessionId is not a canonical anonymous identity.')
  }
  return value
}

/**
 * The anonymous owner scope, checked AGAINST its session id rather than trusted.
 *
 * A mismatched pair is the signature of a caller assembling a claim instead of
 * deriving both halves from one verified cookie — which is precisely how "make
 * this conversation mine" would become something a request could ask for.
 */
function anonymousOwner(value: string, sessionId: string): string {
  if (value !== `anon:${sessionId}`) {
    throw new InvalidOperationError('anonymousOwner must be anon: followed by anonymousSessionId.')
  }
  return value
}

/**
 * A preference patch, bounded before it leaves this process.
 *
 * The Brain validates it again — this is not the security boundary — but an
 * unbounded object forwarded from a browser is a payload nobody sized. Keys are
 * capped in number and length so a patch cannot become a denial of service, and
 * values are limited to the JSON primitives preferences are made of.
 */
function preferencePatch(patch: Record<string, unknown>): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new InvalidOperationError('a preference patch must be an object.')
  }
  const entries = Object.entries(patch)
  if (entries.length === 0) throw new InvalidOperationError('a preference patch must name at least one setting.')
  if (entries.length > 40) throw new InvalidOperationError('too many preferences in one update.')

  const out: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)) {
      throw new InvalidOperationError(`'${key}' is not a valid preference name.`)
    }
    if (typeof value === 'string') {
      if (value.length > 4000) throw new InvalidOperationError(`'${key}' is too long.`)
      out[key] = value
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
    } else {
      throw new InvalidOperationError(`'${key}' must be a string, number or boolean.`)
    }
  }
  return out
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

/**
 * A message's content, which may legitimately be a PICTURE rather than words.
 *
 * WHY THIS IS NOT `text()`. An image-generation turn produces no text at all.
 * `text()` rejects an empty string — correctly, for a prompt — so the assistant
 * message carrying a generated PNG was refused before it left this process, and
 * the user was told "the answer arrived but could not be saved" while the image
 * sat correctly stored in their library with a canonical ref. The turn's whole
 * output was orphaned by a validator written for a different field.
 *
 * Empty is allowed ONLY when the message carries at least one image ref, so a
 * genuinely empty message is still refused.
 */
function messageContent(value: string, imageRefs?: readonly string[]): string {
  if (typeof value === 'string' && !value.trim() && imageRefs && imageRefs.length > 0) {
    return ''
  }
  return text(value, 'content')
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

    case 'setConversationGrounding':
      return {
        method: 'PUT',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}/grounding`,
        body: { files: op.files.map((f) => filename(f)) },
      }

    case 'setConversationImages':
      return {
        method: 'PUT',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}/images`,
        /*
         * Refs pass through unmapped — no `filename()` here. These are opaque
         * content-addressed ids, and running them through a filename sanitiser
         * would be treating them as names, which is exactly the confusion the
         * separate field exists to prevent.
         */
        body: { images: op.images },
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
        body: {
          role: op.role,
          content: messageContent(op.content, op.imageRefs),
          // Refs only, and only when present. This is the write that makes a
          // picture survive a reload on the turn that asked about it.
          ...(op.imageRefs && op.imageRefs.length > 0 ? { imageRefs: op.imageRefs } : {}),
          // And the documents, for the same reason: without this the file that
          // grounded the answer is recorded nowhere on the turn that attached it.
          ...(op.fileRefs && op.fileRefs.length > 0 ? { fileRefs: op.fileRefs } : {}),
        },
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
          /*
           * DURABLE, ALWAYS, AND STATED EXPLICITLY.
           *
           * The Brain defaults `memoryPolicy.mode` to `session`, which keeps a
           * conversation in process memory and writes NOTHING. This client never
           * sent the field, so nothing had ever been persisted: production held
           * zero conversations and zero messages while the product appeared to
           * work, because a thread survives exactly as long as the Brain process
           * that is holding it. A restart discarded every conversation silently.
           *
           * That is also why message image refs seemed to vanish on reopen — the
           * write path was correct and the row was never written at all.
           *
           * Always explicit, never inherited: a default that decides whether a
           * user's history exists is not something to leave unstated.
           */
          memoryPolicy: { mode: 'durable', retrieve: true, store: true },
          /*
           * An ORDERED list of opaque refs, sent only when there is one. The
           * Brain resolves each through its own storage state — nothing here
           * names a path, and the browser could not supply one if it tried.
           */
          ...(op.attachments && op.attachments.length > 0 ? { attachments: op.attachments } : {}),
          /*
           * The Brain reads `attachments` for vision, keyed on `mimeType`. Sent
           * only when non-empty: an empty array would set `hasImage` false
           * anyway, but sending one says "this turn had images" to every log and
           * audit line that counts them.
           */
          ...(op.imageAttachments && op.imageAttachments.length > 0
            ? { attachments: op.imageAttachments }
            : {}),
          // Only when non-empty: an empty array must not read as "scope to nothing",
          // which would refuse every grounded answer.
          ...(op.groundingFiles && op.groundingFiles.length > 0
            ? { groundingFiles: op.groundingFiles.map((f) => filename(f)) }
            : {}),
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

    case 'visionCapability':
      return { method: 'GET', path: '/api/ai/vision-registry' }

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

    case 'getPreferences':
      return { method: 'GET', path: '/api/ai/preferences' }

    case 'patchPreferences':
      return { method: 'PATCH', path: '/api/ai/preferences', body: preferencePatch(op.patch) }

    case 'preferenceEvents':
      return { method: 'GET', path: '/api/ai/preferences/events' }

    case 'anonymousQuota':
      return { method: 'GET', path: '/api/ai/anonymous/quota' }

    case 'reserveAnonymousTurn':
      return {
        method: 'POST',
        path: '/api/ai/anonymous/reserve',
        body: {
          reservationId: id(op.reservationId, 'reservationId'),
          ...(op.conversationId
            ? { conversationId: id(op.conversationId, 'conversationId') }
            : {}),
        },
      }

    case 'settleAnonymousTurn':
      return {
        method: 'POST',
        path: '/api/ai/anonymous/settle',
        body: {
          reservationId: id(op.reservationId, 'reservationId'),
          // Explicit boolean, never a truthy value: `producedOutput: undefined`
          // reads as a release at the Brain, which would refund a served answer.
          producedOutput: op.producedOutput === true,
          ...(op.failure ? { failure: text(op.failure, 'failure', 120) } : {}),
        },
      }

    case 'claimAnonymousConversation':
      return {
        method: 'POST',
        path: '/api/ai/anonymous/claim',
        body: {
          conversationId: id(op.conversationId, 'conversationId'),
          anonymousSessionId: anonymousSessionId(op.anonymousSessionId),
          // Re-derived here rather than forwarded, so a caller cannot name one
          // session and a different owner. The Brain checks the pair again.
          anonymousOwner: anonymousOwner(op.anonymousOwner, op.anonymousSessionId),
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
