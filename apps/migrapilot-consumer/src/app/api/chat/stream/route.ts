/**
 * A streamed chat turn.
 *
 *   browser ── SSE ──► this authenticated route ── SSE ──► Brain ──► model
 *
 * Same trust boundary as the buffered turn: `streamBrain` runs the identical
 * preamble (session → derived scope → closed operation set), so nothing here
 * can widen it. This route re-frames the Brain's stream for the browser; it
 * never forwards the Brain's frames verbatim, because those carry routing and
 * provider detail the browser has no business seeing.
 *
 * WHY STREAM. The buffered turn is correct but the wait is not survivable: a
 * cold model load has exceeded 240 seconds with nothing on screen. Streaming
 * turns that into a `status` frame immediately and tokens as they are produced.
 *
 * A SIGNED-OUT VISITOR CAN USE THIS. Identity is resolved once, at the top, as
 * either a verified session or a signed anonymous cookie, and carried through
 * every Brain call in this request. Resolving per call would mint a new
 * anonymous identity each time — a new allowance each time.
 *
 * THE ALLOWANCE IS TAKEN BEFORE THE MODEL IS ASKED ANYTHING, and settled on what
 * actually happened:
 *
 *   reserve → persist the prompt → stream the answer → consume, or release
 *
 * Exhaustion stops the turn here, before inference. Infrastructure failing
 * before any token reached the user returns the turn. An answer that arrived and
 * then failed to persist does NOT: the user got something real, and refunding it
 * because our storage blinked would make the limit meaningless in exactly the
 * cases people would learn to reproduce.
 *
 * PERSISTENCE RULE, and the whole reason this route is careful: the answer is
 * stored ONLY when the stream completes. A partial, interrupted or cancelled
 * stream persists nothing, exactly as the Brain does for its own memory —
 * writing a truncated answer would leave a durable conversation whose history
 * claims the model said something it never finished saying.
 */

import {
  appendMessage,
  chatTurnStream,
  createConversation,
  getConversation,
  listMessages,
  setConversationGrounding,
  setConversationImages,
} from '@/server/brain/seams'
import { listCapabilities, orchestrateTurn } from '@/server/brain/seams'
import { NO_AUTHORITY } from '@migrapilot/shared-types/project-authority'
import { MAX_EXTRACT_BYTES, MAX_FILE_BYTES, MAX_FILES, listFiles, userDirectory } from '@/server/files/storage'
import { visionCapability } from '@/server/files/visionCapability'
import { micAvailability } from '@/server/brain/view'
import { transcriptionCapability } from '@/server/brain/seams'
import {
  platformCapabilityAnswer,
  platformCapabilityTopics,
} from '@/features/capabilities/platformAnswer'
import { reconcileGrounding } from '@/server/files/grounding'
import { listProcessing, readProcessing, sequenceNoteFor } from '@/server/files/documentProcessing'
import { describeReadFailures, type ReadFailure } from '@/features/attachments/readFailure'
import { documentReaderCapability, UNKNOWN_READER } from '@/server/files/documentReaderCapability'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { reserveTurnFor, settleTurnFor } from '@/server/anonymous/turnQuota'
import type { Principal } from '@/server/tenancy/principal'
import type { BrainStreamFrame } from '@/server/brain/gateway'
import type { ConversationSummary } from '@/server/brain/contracts'
import { resolveTurnImages } from '@/server/files/resolveTurnImages'
import { selectTurnGrounding } from '@/server/files/turnGrounding'
import { decideAttachmentState } from '@/server/files/attachmentState'
import { canAnalyzeStructurally, canIndex, extensionOf } from '@/features/attachments/capability'
import { workbookDisclosureFor } from '@/features/attachments/spreadsheetDisclosure'
import { tableEvidenceFor } from '@/server/tables/tableEvidence'
import { sheetContentEvidenceFor } from '@/server/tables/sheetContent'
import { orderAttachments, resolveActiveSheet, referenceEvidence } from '@/server/files/turnReference'
import { projectEvidenceFor } from '@/server/projects/projectEvidence'
import { assessDocumentIntent } from '@/server/files/documentIntent'
import { planRegeneration, wantsRegeneration } from '@/server/files/regenerate'
import { saveImage } from '@/server/files/imageStore'
import { adoptRequestId, TurnTrace } from '@/server/observability/turnTrace'

export const dynamic = 'force-dynamic'

const json = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status })

function titleFrom(prompt: string): string {
  const line = prompt.trim().split('\n')[0]!.trim()
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

/**
 * Which of the caller's real documents an answer refers to.
 *
 * The Brain instructs the model to cite `path:startLine-endLine` for retrieved
 * evidence, but it does not report the chunks it used back over the stream, so
 * the only citations available here are the ones the MODEL wrote — and a model
 * can write a filename it never read.
 *
 * So nothing is trusted: every candidate is intersected with the caller's
 * actual library, and anything that does not name a file they really have is
 * dropped. The result is therefore always a subset of real files. It can
 * under-report — a document used but not named will not appear — and that is
 * the correct direction to be wrong in. A fabricated citation is a false claim
 * about provenance; a missing one is merely incomplete.
 */
/**
 * Turn retrieved page numbers into something a reader can act on.
 *
 * Contiguous runs become "pages 7-8"; a scattered set stays a list. The rule is
 * that the label must describe pages that were actually retrieved — a range is a
 * claim about everything between its ends, and inventing one is the citation
 * equivalent of the filename attribution bug this replaced.
 */
export function describePages(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  if (sorted.length === 1) return `page ${sorted[0]}`

  const runs: Array<[number, number]> = []
  for (const page of sorted) {
    const last = runs[runs.length - 1]
    if (last && page === last[1] + 1) last[1] = page
    else runs.push([page, page])
  }
  // Many scattered pages: a count is honest where a list would be unreadable.
  if (runs.length > 3) return `${sorted.length} pages`
  return `pages ${runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')}`
}

export async function attributedFiles(groundedPaths: readonly string[]): Promise<string[]> {
  if (groundedPaths.length === 0) return []
  const owned = await listFiles().catch(() => [])
  if (owned.length === 0) return []

  /*
   * The engine reports index paths; the library is keyed by name. Matched on the
   * basename and then INTERSECTED with the caller's own files, so a path that is
   * not one of their documents can never be surfaced as a source.
   */
  const grounded = new Set(groundedPaths.map((p) => p.split('/').pop() ?? p))
  return [...new Set(owned.filter((file) => grounded.has(file.name)).map((file) => file.name))]
}

/**
 * A grounded turn the Brain refused, distinguished from a fault.
 *
 * In `approved` mode the Brain answers 409 `INSUFFICIENT_APPROVED_EVIDENCE`
 * rather than letting the model answer from its own priors. That is the feature
 * working, not an error, and the user needs to hear the actual reason — "your
 * documents do not cover this" — instead of a generic failure that invites them
 * to retry an identical question forever.
 */
/**
 * Codes the Brain returns when it DECIDED not to answer.
 *
 * A refusal is a real response to the user's question — "I cannot edit images
 * yet", "your documents do not cover that" — and belongs in the conversation
 * exactly like any other answer. A transport fault is not: it is our problem,
 * it says nothing about what was asked, and storing it would put our outage in
 * the user's history forever.
 */
const DELIBERATE_REFUSALS: readonly string[] = [
  'IMAGE_EDITING_UNAVAILABLE',
  'IMAGE_GENERATION_NOT_CONFIGURED',
  'INSUFFICIENT_APPROVED_EVIDENCE',
  'VISION_NOT_QUALIFIED',
]

/** The refusal code, when the Brain refused on purpose rather than failed. */
function deliberateRefusalCode(failure: { kind: string; body?: unknown }): string | null {
  const body = (failure as { body?: unknown }).body
  const parsed =
    typeof body === 'string'
      ? (() => {
          try {
            return JSON.parse(body) as { code?: string }
          } catch {
            return null
          }
        })()
      : (body as { code?: string } | null)
  const code = parsed?.code
  return code && DELIBERATE_REFUSALS.includes(code) ? code : null
}

function refusalOr(
  failure: { kind: string; body?: unknown; status?: number },
  /** Attached files the approved index holds no chunks for. */
  unreadable: readonly string[] = [],
  /** Attached files that exist and could be used. */
  available: readonly string[] = [],
  /** The index contradicts its own record — say nothing about the FILES. */
  indexUnavailable = false,
  /**
   * The table layer already produced figures for this turn.
   *
   * A computed answer means the question WAS answerable, so no refusal here may
   * speak over it.
   */
  hasTableEvidence = false,
  /**
   * The subset of `unreadable` that is unreadable because it is TOO LARGE.
   *
   * Separate because the sentence is about the ceiling, not the contents.
   */
  tooLarge: readonly string[] = [],
  /**
   * What the document reader actually concluded about each unreadable file.
   *
   * 🚨 SIX DIFFERENT FACTS WERE ARRIVING AS ONE SENTENCE. A damaged file, a
   * scan with no text layer, a password-protected file, a genuinely empty one,
   * and a SERVER MISSING ITS PDF RENDERER all produce zero chunks, and all five
   * were reported as "No readable content was found in <file>".
   *
   * The last one is the reason this is not cosmetic. The reader had recorded
   * "the page renderer is not available on this server" — it knew the file was
   * fine and the SERVER was not — and the chat path discarded that and told the
   * user their document was empty. One of those sends a person to re-scan a
   * perfectly good book; the other is an operator's job and the user should do
   * nothing at all.
   */
  readFailures: readonly ReadFailure[] = [],
): {
  error: string
  message: string
} {
  const outage = persistenceOutage(failure)
  if (outage) return outage

  if (failure.kind === 'brain_error' || failure.kind === 'conflict') {
    const body = failure.body
    const parsed =
      typeof body === 'string'
        ? (() => {
            try {
              return JSON.parse(body) as { code?: string; error?: string }
            } catch {
              return null
            }
          })()
        : (body as { code?: string; error?: string } | null)

    if (parsed?.code === 'IMAGE_EDITING_UNAVAILABLE') {
      /*
       * The Brain's sentence is relayed VERBATIM here, unlike the evidence
       * refusal below. It was written for this exact situation and for this
       * audience: it says what MigraPilot can do with the image, what it cannot
       * do yet, and the one thing the user can do instead. Paraphrasing it in a
       * second place would let the two drift.
       */
      return {
        error: 'image_editing_unavailable',
        message:
          parsed.error ??
          'I can understand the image, but image editing is not available in MigraPilot yet. ' +
            'I can generate a new image based on your requested change instead.',
      }
    }

    if (parsed?.code === 'IMAGE_GENERATION_NOT_CONFIGURED') {
      /*
       * A FEATURE THAT IS OFF, NOT A SERVICE THAT BROKE.
       *
       * This used to arrive as the generic `brain_error`, so a client could not
       * distinguish "MigraPilot is down" from "this deployment does not do
       * that" — and only one of those is worth retrying. The Brain classifies
       * it; this reads the classification rather than the sentence.
       */
      return {
        error: 'image_generation_not_configured',
        message:
          parsed.error ??
          'Image generation is not set up on this deployment, so there is nothing to run. ' +
            'I can still describe an image, or help you write a prompt for one elsewhere.',
      }
    }

    if (parsed?.code === 'VISION_NOT_QUALIFIED') {
      /*
       * A MEASURED CAPABILITY LIMIT, NOT A FAULT — and it reached the user as
       * "The assistant service could not complete this request."
       *
       * The Brain refuses 422 VISION_NOT_QUALIFIED when a question needs a
       * vision skill the running model was measured on and failed: counting is
       * the current one, because it miscounts with no signal that it has, so a
       * number would look confident and be wrong. Refusing is the correct
       * behaviour. Reporting it as a service fault is not: it hides a permanent,
       * explainable limit behind a message that invites the user to retry the
       * identical question forever, and it makes an honest system look broken.
       *
       * Relayed VERBATIM for the same reason as IMAGE_EDITING_UNAVAILABLE above:
       * the sentence was written where the measurement lives, and a paraphrase
       * here would be a second definition of the limit, free to drift from the
       * evidence that set it.
       */
      return {
        error: 'vision_not_qualified',
        message:
          parsed.error ??
          'I can look at this image, but not answer that particular question about it — ' +
            'the vision model running here was measured on that skill and is not reliable at it. ' +
            'Ask me to describe what the image shows instead.',
      }
    }

    if (parsed?.code === 'INSUFFICIENT_APPROVED_EVIDENCE') {
      /*
       * The Brain's own text is NOT relayed. It is written for the repository
       * case and tells the reader to "sync and approve the current branch" —
       * developer language about code, and here it is also simply wrong: an
       * index IS approved. The refusal is the relevance floor rejecting a
       * retrieval, which for this product means one thing worth saying.
       */
      /*
       * "Try naming the document" is impossible to satisfy when the attached files hold no
       * indexed content — naming a file with zero chunks cannot retrieve anything. Advice a
       * user cannot act on is worse than no advice.
       */
      /*
       * The index contradicting itself is checked FIRST, and the order matters.
       *
       * When chunks fail to restore, every per-file count reads zero, so the
       * `allUnreadable` branch below would fire and blame the user's files. It is
       * the more specific truth and it must win: the files are fine, the index
       * cannot answer, and a reindex fixes it. Saying "no readable content was
       * found in <file>" here is a confident falsehood about content the user can
       * see in their own library — worse than an error, because nothing signals
       * that trying again would work.
       */
      if (indexUnavailable) {
        return {
          error: 'index_unavailable',
          message:
            'Your file index is temporarily unavailable, so nothing could be read from your ' +
            'documents for this answer. Your files are still there and unchanged — reindex them ' +
            'and ask again.',
        }
      }

      const allUnreadable = available.length > 0 && unreadable.length === available.length
      if (allUnreadable) {
        /*
         * 🚨 A STRUCTURED FILE IS NOT AN EMPTY ONE, and must not be described as
         * one. A workbook is accepted for deterministic table analysis and is
         * deliberately NOT indexed for prose — the Brain cannot retrieve text
         * from a zip container. It therefore holds zero chunks and lands here
         * looking identical to a genuinely empty document.
         *
         * "No readable content was found in budget.xlsx" is a confident
         * falsehood about content the user is looking at. The sentence has to
         * say what is actually true: the tables can be analysed, the text cannot
         * be searched.
         */
        const structuredOnly = unreadable.filter(
          (name) => canAnalyzeStructurally(extensionOf(name)) && !canIndex(extensionOf(name)),
        )
        /*
         * Belt and braces: if the table layer produced figures, the question was
         * answerable and this refusal must not speak over it. The mode fix above
         * should mean we never arrive here with evidence in hand.
         */
        if (structuredOnly.length === unreadable.length && !hasTableEvidence) {
          const names = structuredOnly.join(', ')
          return {
            error: 'insufficient_evidence',
            message:
              `MigraPilot can analyze ${names} as structured spreadsheet data — sheets, columns, ` +
              `labels and numeric values — but general document-style text search inside ` +
              `spreadsheets is not available yet, so this question cannot be answered that way. ` +
              `Ask about a total, a column or a sheet, or attach a CSV if you need its text searched.`,
          }
        }

        /*
         * 🚨 TOO LARGE IS NOT EMPTY, for exactly the reason a spreadsheet is not
         * empty. A file above the extract ceiling is never handed to the parser,
         * so it holds zero chunks and arrives here looking identical to a blank
         * document. Measured on staging: 28.6 MB of plain repeated ASCII was
         * described as having "no readable content" — a claim the user can
         * disprove by opening the file, and one that offers them nothing to do.
         *
         * The limit is named, because "make it smaller" is only actionable if
         * you know smaller than what.
         */
        const oversized = unreadable.filter((name) => tooLarge.includes(name))
        if (oversized.length === unreadable.length) {
          const names = oversized.join(', ')
          const limitMb = Math.floor(MAX_EXTRACT_BYTES / 1_048_576)
          return {
            error: 'file_too_large_to_read',
            message:
              `${names} is stored and intact, but it is larger than the ${limitMb} MB that ` +
              `MigraPilot can read from a single document, so nothing was indexed from it. ` +
              `Attach a smaller file, or split this one and attach the part you need.`,
          }
        }

        /*
         * 🚨 THE READER'S OWN VERDICT, WHERE IT HAS ONE.
         *
         * `describeReadFailures` returns null unless EVERY unreadable file has a
         * recognised cause, so a partial explanation never stands in for files
         * whose cause is unknown. See readFailure.ts.
         */
        const explained = describeReadFailures(unreadable, readFailures)
        if (explained) return explained

        const names = unreadable.join(', ')
        return {
          error: 'insufficient_evidence',
          message:
            `No readable content was found in ${names}, so there is nothing to answer from. ` +
            `Attach a file with text in it, or ask about a different document.`,
        }
      }
      return {
        error: 'insufficient_evidence',
        message:
          'Your indexed documents do not cover that. Try naming the document or asking something more specific — nothing here is a generated answer.',
      }
    }
  }
  return reasonFor(failure.kind)
}

/**
 * A storage outage, reported as a storage outage.
 *
 * The Brain answers 503 PERSISTENCE_UNAVAILABLE when a durable write cannot be
 * committed. That arrived here as a generic `brain_error` — "The assistant
 * service could not complete this request" — which reads as a model or service
 * fault and invites the user to retry the identical request forever. The real
 * fact is narrower, it is not their fault, and it is actionable: nothing was
 * saved, so nothing was answered.
 *
 * The code travels in the Brain's response BODY, which the generic mapping
 * never read. Verified on the canary: the Brain returned 503 with this code and
 * the user was shown the generic service message.
 */
function persistenceOutage(failure: { kind: string; body?: unknown }): { error: string; message: string } | null {
  const body = failure.body
  const parsed =
    typeof body === 'string'
      ? (() => {
          try {
            return JSON.parse(body) as { code?: string }
          } catch {
            return null
          }
        })()
      : (body as { code?: string } | null)

  if (parsed?.code !== 'PERSISTENCE_UNAVAILABLE') return null
  return {
    error: 'persistence_unavailable',
    message:
      'Your message could not be saved, so it was not answered. Storage is unavailable right now — nothing was lost, because nothing was stored. Try again shortly.',
  }
}

/** The failure vocabulary the client renders. Mirrors the buffered turn. */
function reasonFor(kind: string): { error: string; message: string } {
  switch (kind) {
    case 'unauthenticated':
      return { error: 'unauthenticated', message: 'Sign in to send a message.' }
    case 'forbidden_for_principal':
      return {
        error: 'requires_account',
        message: 'That needs an account. Sign in to continue this conversation.',
      }
    case 'tenancy_unresolved':
      return {
        error: 'tenancy_unresolved',
        message: 'Your account is missing the identity needed to route this request.',
      }
    case 'timeout':
      return {
        error: 'model_timeout',
        message: 'The model did not answer in time. It may still be loading — try again shortly.',
      }
    case 'transport_failure':
      return { error: 'brain_unreachable', message: 'The assistant service is unreachable right now.' }
    case 'not_found':
      return { error: 'not_found', message: 'That conversation no longer exists.' }
    default:
      return { error: 'brain_error', message: 'The assistant service could not complete this request.' }
  }
}

export async function POST(request: Request): Promise<Response> {
  /*
   * THE TRACE ID, BEFORE ANYTHING ELSE CAN FAIL.
   *
   * Minted here rather than at the first Brain call, because the stages worth
   * measuring — resolving a principal, reserving an allowance, reading an
   * image — all happen before the Brain is asked anything, and those are
   * precisely the ones that used to be invisible. The browser's id is adopted
   * when it is well-formed so the client's own timings share the name.
   */
  const adopted = adoptRequestId(request.headers.get('x-request-id'))
  const trace = new TurnTrace(adopted.id)
  trace.set('client_id', !adopted.minted)

  /*
   * ONE principal for the whole request.
   *
   * Every Brain call below is made as this principal. Resolving it per call
   * would give a cookie-less visitor a different anonymous identity for the
   * conversation, the prompt, the turn and the answer — four allowances, and a
   * conversation nobody can read back.
   */
  const resolved = await resolveRequestPrincipal()
  if (!resolved) return json(401, 'unauthenticated', 'Sign in to send a message.')
  if (!resolved.identityPersisted) {
    // A minted identity that could not be written would be replaced on the next
    // request, which is a fresh allowance every time. Refuse rather than serve.
    return json(503, 'session_unavailable', 'A session could not be started. Try again shortly.')
  }
  const principal: Principal = resolved.principal
  trace.set('anonymous', principal.kind === 'anonymous')
  trace.mark('principal')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(400, 'invalid_body', 'Expected a JSON body.')
  }

  const prompt = (body as { prompt?: unknown })?.prompt
  /*
   * The Migra family the browser selected, if any. Validated only as a string
   * here — the Brain owns which families exist and whether one is currently
   * serviceable, and duplicating that judgement in this route is how two
   * surfaces start disagreeing.
   */
  const rawFamily = (body as { modelFamily?: unknown })?.modelFamily
  const modelFamily = typeof rawFamily === 'string' && rawFamily.trim() ? rawFamily.trim() : undefined
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return json(400, 'invalid_prompt', 'A non-empty prompt is required.')
  }

  const requested = (body as { conversationId?: unknown })?.conversationId
  let conversationId = typeof requested === 'string' && requested.trim() ? requested.trim() : undefined

  /*
   * THE ALLOWANCE, BEFORE ANYTHING IS SPENT.
   *
   * Ahead of creating a conversation, ahead of storing the prompt, and far
   * ahead of the model. A visitor who is out of turns must cost nothing: no
   * row, no inference, no partial thread that implies an answer is coming.
   */
  const allowance = await reserveTurnFor(principal, conversationId)
  if (allowance.kind === 'exhausted') {
    return Response.json(
      {
        error: 'quota_exhausted',
        message:
          'You have used all your free messages. Sign in or create an account to keep going — this conversation comes with you.',
        quota: allowance.quota,
      },
      { status: 429 },
    )
  }
  if (allowance.kind === 'unavailable') {
    return json(allowance.status, allowance.error, allowance.message)
  }
  const reservationId = allowance.kind === 'reserved' ? allowance.reservationId : null
  trace.mark('allowance')

  /**
   * Give the turn back. Used for every failure BEFORE useful output.
   *
   * Idempotent at the Brain, so a path that releases and then falls through to
   * another release charges nothing twice.
   */
  const release = async (reason: string): Promise<void> => {
    if (!reservationId) return
    await settleTurnFor(principal, { reservationId, producedOutput: false, failure: reason })
  }

  // Persistence before generation, identical to the buffered route: the user's
  // own message is durable even if the model never answers.
  if (!conversationId) {
    const created = await createConversation(titleFrom(prompt), { principal })
    if (created.kind !== 'ok') {
      await release('persistence_unavailable')
      const outage = persistenceOutage(created)
      if (outage) return json(503, outage.error, outage.message)
      const reason = reasonFor(created.kind)
      return json(created.kind === 'unauthenticated' ? 401 : 502, reason.error, reason.message)
    }
    conversationId = (created.value as ConversationSummary)?.id
    if (!conversationId) {
      await release('persistence_unavailable')
      return json(502, 'brain_error', 'The assistant service did not return a conversation.')
    }
  }

  /*
   * A SIGNED-OUT VISITOR HAS NO LIBRARY, so there is nothing to ground on.
   *
   * Files, indexes and uploads are authenticated-only — the gateway refuses them
   * for an anonymous principal, and `listFiles` has no directory to read without
   * a session. Skipping the whole reconciliation is therefore the honest path:
   * running it would produce an empty set through three failed calls and could
   * only ever arrive at the same `none`.
   */
  const canGround = principal.kind === 'session'

  /*
   * ── IMAGES ────────────────────────────────────────────────────────────────
   *
   * The same durable-set discipline as grounding, against a different store.
   *
   * ATTACHING ADDS TO THE THREAD'S SET. That is what makes the follow-up work:
   * "what colour is the main object?" asked after a reload carries no upload, so
   * the conversation has to remember which picture it is about — otherwise the
   * second question is answered about nothing while looking like it worked.
   *
   * RECONCILED AGAINST REALITY every turn, because the set outlives the files in
   * it. A deleted image would otherwise stay named here forever, and a ref that
   * resolves to nothing is not evidence the model saw anything.
   */
  const imagesAttachedNow =
    canGround && Array.isArray((body as { images?: unknown })?.images)
      ? ((body as { images: unknown[] }).images.filter(
          (r): r is string => typeof r === 'string' && r.trim().length > 0,
        ) as string[])
      : []

  const priorConversation = canGround && conversationId
    ? await getConversation(conversationId, { principal })
    : ({ kind: 'not_found' } as const)
  const storedImages =
    priorConversation.kind === 'ok' ? ((priorConversation.value as ConversationSummary)?.imageRefs ?? []) : []
  const requestedImages = [...new Set([...storedImages, ...imagesAttachedNow])]

  // Resolution IS the reconciliation: a ref that cannot produce bytes for this
  // caller cannot be part of the thread's set either.
  const resolvedImages = canGround && requestedImages.length > 0
    ? await resolveTurnImages(requestedImages)
    : {
        attachments: [],
        dropped: [] as { ref: string; reason: string }[],
        prepared: [] as { ref: string; storedBytes: number; sentBytes: number; downscaled: boolean; fromCache: boolean }[],
      }
  const liveImages = resolvedImages.attachments.map((a) => a.name)
  if (requestedImages.length > 0) {
    /*
     * The image cost, stated in the trace rather than inferred from the turn's
     * total. `warm` is the one that matters: a cold image pays ~1.8s of decode
     * on this hardware, and without this field a slow turn and a cold cache look
     * identical from the outside.
     */
    trace.set('images', {
      requested: requestedImages.length,
      sent: resolvedImages.attachments.length,
      dropped: resolvedImages.dropped.length,
      stored_kb: Math.round(resolvedImages.prepared.reduce((n, p) => n + p.storedBytes, 0) / 1024),
      sent_kb: Math.round(resolvedImages.prepared.reduce((n, p) => n + p.sentBytes, 0) / 1024),
      downscaled: resolvedImages.prepared.filter((p) => p.downscaled).length,
      warm: resolvedImages.prepared.filter((p) => p.fromCache).length,
    })
  }
  trace.mark('images')

  /*
   * THE CONVERSATION'S IMAGE IS GONE.
   *
   * Its refs are reconciled away above, which is correct — but silently. The
   * thread was ABOUT a picture, the picture has been deleted, and the next
   * question would have been answered as though it had never been attached:
   * confidently, ungrounded, with nothing telling the user why the answer
   * stopped describing their image.
   *
   * Only when the ACTIVE set is what was lost, and nothing replaced it. An
   * unrelated historical image on an older message is not this situation, and
   * neither is a turn that brought its own attachment.
   *
   * Self-limiting: the refs are cleared just below, so this is said once and the
   * conversation then behaves as an ordinary text thread.
   */
  const activeImageLost =
    canGround &&
    storedImages.length > 0 &&
    liveImages.length === 0 &&
    imagesAttachedNow.length === 0

  const imagesChanged =
    liveImages.length !== storedImages.length || liveImages.some((r, i) => r !== storedImages[i])
  if (canGround && conversationId && imagesChanged) {
    // Persisted BEFORE answering, for the same reason grounding is: a turn must
    // not claim an image set the next turn will not have.
    await setConversationImages(conversationId, liveImages, { principal })
  }

  /*
   * THE CONVERSATION DECIDES, NOT THE BROWSER.
   *
   * `grounded` used to be read straight off the request body, and the client
   * remembered it in a React ref. A reload wiped that ref, so the same question in
   * the same thread stopped using the file and answered "I don't have access to
   * external documents" with the earlier grounded answers still on screen.
   *
   * Now the browser only reports INTENT for the turn that carries an attachment;
   * the durable set on the conversation is what actually decides, and it is read
   * back from the Brain on every turn. A reload cannot change the answer because
   * nothing about grounding lives in the tab.
   */

  const attachedNow =
    canGround && Array.isArray((body as { attachments?: unknown })?.attachments)
      ? ((body as { attachments: unknown[] }).attachments.filter(
          // A `typeof` check alone let [''] through, and an empty filename would have
          // grounded the turn on nothing — grounded:true with no document behind it.
          (f): f is string => typeof f === 'string' && f.trim().length > 0,
        ) as string[])
      : []

  const existing = canGround
    ? await getConversation(conversationId, { principal })
    : ({ kind: 'not_found' } as const)
  const storedGrounding =
    existing.kind === 'ok' ? ((existing.value as ConversationSummary)?.groundingFiles ?? []) : []

  /*
   * 🚨 THE THREAD KEEPS EVERY FILE. THIS TURN DOES NOT ANSWER FROM ALL OF THEM.
   *
   * `requestedGrounding` is still the full set, because that is what the
   * conversation owns and what gets persisted — naming a file later must bring
   * it back. What changed is that the ACTIVE set below is chosen per turn, so
   * attaching a new document and asking about it no longer answers from an
   * unrelated older one. See `selectTurnGrounding` for the rules and for why
   * this was safe to change only after conversation history started flowing.
   */
  const requestedGrounding = [...new Set([...storedGrounding, ...attachedNow])]

  /*
   * RECONCILE AGAINST REALITY BEFORE ANSWERING.
   *
   * The set is durable, so it outlives the files in it. A deleted file would still be
   * named here, and one name is enough to send groundingMode "approved" for a document
   * that no longer exists. Durable state that is never checked is a stale claim with a
   * database behind it.
   */
  const reconciled = canGround
    ? await reconcileGrounding(requestedGrounding)
    : {
        grounded: false,
        available: [] as string[],
        uploadedAt: {} as Record<string, number>,
        missing: [] as string[],
        unreadable: [] as string[],
        tooLarge: [] as string[],
        indexUnavailable: false,
        libraryUnreadable: false,
      }

  // A file that is GONE leaves the set permanently, and the correction is written back
  // so the drift does not outlive the turn. A merely unsearchable index changes nothing
  // about the set — searchability returns, and discarding the user's choice would not.
  // A set derived from an unreadable library is not a fact, so it is never written.
  // Without this guard, attaching a file during a storage hiccup would still erase
  // the thread's existing grounding — the same data loss by a second route.
  const shouldPersist =
    !reconciled.libraryUnreadable &&
    (reconciled.missing.length > 0 || requestedGrounding.length !== storedGrounding.length)
  if (canGround && shouldPersist) {
    // Persist BEFORE answering: if the write fails the turn must not claim a grounding
    // the next turn will not have.
    await setConversationGrounding(conversationId, reconciled.available, { principal })
  }

  /*
   * Chosen from what actually EXISTS, not from what was requested: reconciling
   * first means a named-but-deleted file cannot become this turn's boundary.
   */
  const turnGrounding = selectTurnGrounding(prompt, attachedNow, reconciled.available, reconciled.uploadedAt)
  trace.set('grounding_reason', turnGrounding.reason)
  trace.set('grounding_active', String(turnGrounding.active.length))
  trace.set('grounding_withheld', String(turnGrounding.withheld.length))

  const grounded = reconciled.grounded

  /*
   * A DOCUMENT QUESTION WITH NO DOCUMENT.
   *
   * Asked for the rollback marker in an indexed runbook that had never been
   * attached to this conversation, the model answered that the command "might be
   * `./rollback.sh`" — fluent, confident, invented. The file existed and Files
   * said "Ready", so the user had every reason to believe it had been read.
   *
   * The library is durable storage; a conversation is grounded by the files
   * ATTACHED TO IT. When those two are confused, the turn must say so rather
   * than answer from nothing.
   */

  /*
   * RESOLVED BEFORE THE TURN IS STORED, because this append is the one that
   * records it. The engine's own in-turn append never runs for a streamed turn —
   * that request carries no conversationId — so refs that arrive after this line
   * reach the conversation's active set and never the message.
   */
  const storedPrompt = await appendMessage(
    conversationId, 'user', prompt, { principal }, liveImages,
    /*
     * THE DOCUMENTS THIS TURN ACTUALLY ANSWERED FROM, recorded on the message.
     *
     * `reconciled.available` rather than what the client attached: a name with no
     * file behind it grounded nothing, so writing it into the transcript would
     * claim a source the answer never had. Grounding is reconciled ABOVE this
     * line for exactly the reason the images are — this append is the record, and
     * anything resolved after it reaches the conversation's active set and never
     * the turn that asked.
     */
    reconciled.available,
  )
  trace.mark('prompt_stored')
  if (storedPrompt.kind !== 'ok') {
    await release('persistence_unavailable')
    // FAIL CLOSED, AND SAY WHY. The prompt is stored before the model runs, so a
    // storage outage stops the turn here — correctly, since answering a turn whose
    // prompt was never stored leaves a conversation that cannot be reconstructed.
    // What was wrong was the explanation, not the refusal.
    const outage = persistenceOutage(storedPrompt)
    if (outage) return json(503, outage.error, outage.message)
    const reason = reasonFor(storedPrompt.kind)
    return json(storedPrompt.kind === 'not_found' ? 404 : 502, reason.error, reason.message)
  }

  const durableId = conversationId
  const summary = (body as { conversationSummary?: unknown })?.conversationSummary
  const conversationSummary = typeof summary === 'string' && summary.trim() ? summary : undefined

  /*
   * Whether this turn may be answered from the caller's documents.
   *
   * `grounded: true` means the Brain must answer from the caller's APPROVED
   * index or refuse — it may not fall back to its own priors. Anything else
   * gets `none`, so an ordinary chat turn never quietly pulls a user's private
   * documents into an unrelated answer.
   *
   * A browser-supplied value is safe here because both modes are strictly
   * narrowing: neither can widen what the caller may see, and tenancy is still
   * derived server-side from the session.
   */
  const documentIntent = assessDocumentIntent(prompt, grounded)

  /*
   * WHAT IS ACTUALLY ATTACHED, independent of whether it is indexed.
   *
   * `grounded` answers "can an approved prose index serve this turn", which is
   * false for a structured attachment by definition. Asking a prose question
   * about an attached workbook therefore reached the "I do not have that
   * document attached to this conversation" refusal — a statement the user can
   * see is false, about a file whose chip is on screen.
   *
   * Four states have to be distinguishable, and only these two need computing
   * here: the rest fall through to the paths that already handle them.
   */
  /*
   * 🚨 THE INTENT SIGNAL, DECOUPLED FROM THE INDEX.
   *
   * `assessDocumentIntent(prompt, grounded)` short-circuits to "no document
   * needed" whenever the caller HAS an approved index — which is true of every
   * real account and of no fresh one. The structured branch was gated on that
   * signal, so it never fired in production: "Summarize the document for me."
   * over an attached workbook went to the model with no context and came back
   * "I cannot summarize a document as no document was provided", about a file
   * whose chip was on screen.
   *
   * Asking with `false` gives the question's OWN shape — does this prompt ask
   * something of a document — with no opinion about what is indexed. Whether a
   * document is available is decided separately, from the attachments.
   */
  const activeExts = turnGrounding.active.map((name) => extensionOf(name))
  const hasActiveAttachment = turnGrounding.active.length > 0
  const activeAllStructuredOnly =
    hasActiveAttachment && activeExts.every((e) => canAnalyzeStructurally(e) && !canIndex(e))

  /*
   * Only for a turn that actually asks to regenerate, and only when an image is
   * in play. Planning it for every turn would read the library on every message
   * for a decision almost none of them need.
   */
  const regeneration = wantsRegeneration(prompt) && liveImages.length > 0
    ? await planRegeneration(liveImages[liveImages.length - 1])
    : null
  /*
   * 🚨 NEVER CLAIM PROSE GROUNDING FOR A FILE THAT HAS NONE.
   *
   * `grounded` is true whenever the caller has an approved index and the named
   * file exists on disk — and a structured file satisfies both while holding
   * zero chunks. Sending `approved` then asks the Brain to answer from prose
   * that does not exist, it refuses for insufficient evidence, and the refusal
   * fires BEFORE the deterministic table evidence in the prompt is ever used.
   *
   * Measured in production: "What is the total Revenue?" over an attached
   * workbook returned "MigraPilot can analyse … but cannot search the text
   * inside it" — a table question answered as though it were a prose one, while
   * the evidence layer had already computed 474,000. It did not reproduce
   * locally because a fresh account has no approved index, so `grounded` was
   * false and the same turn worked.
   *
   * A workbook has no prose to retrieve, so the honest mode is `none`. The table
   * evidence still travels in the prompt and is what answers the question.
   */
  const groundingMode = grounded && !activeAllStructuredOnly ? 'approved' : 'none'

  const encoder = new TextEncoder()
  /** Set once the upstream stream opens; stays null if the client leaves first. */
  let frames: AsyncGenerator<BrainStreamFrame> | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = ''
      /** Refs for images this turn GENERATED, in order, persisted with the answer. */
      const generatedImages: string[] = []
      /** True once the user has been told WHY, so nothing generic overwrites it. */
      let explained = false
      /*
       * Set when the provider proved it could not decode what was sent.
       * Drives the active-image set being cleared below — see there for why.
       */
      let unreadableImage = false
      let completed = false
      let closed = false

      /**
       * Close the reservation on what ACTUALLY happened, and report the result.
       *
       * `producedOutput` is the pivot, not the HTTP status: tokens that reached
       * the user are output even if persistence then failed, and a stream that
       * ended cleanly having said nothing is not.
       */
      const settle = async (
        producedOutput: boolean,
        failure?: string,
      ): Promise<import('@migrapilot/shared-types/anonymous-quota').AnonymousChatQuota | null> => {
        if (!reservationId) return null
        const settlement = await settleTurnFor(principal, {
          reservationId,
          producedOutput,
          ...(failure ? { failure } : {}),
        })
        return settlement.quota
      }

      const emit = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      /*
       * FIRST BYTE BEFORE THE BRAIN IS EVEN ASKED. This is the whole point of
       * the route, and getting the order wrong silently defeats it.
       *
       * The Brain's SSE headers are not flushed when it calls `writeHead` —
       * Node sends them with the first `write()`, and the Brain's first write
       * is the `route` frame, which it only emits after pulling the model's
       * first token. So awaiting the Brain's response before replying here
       * meant the browser received NOTHING, not even headers, until the model
       * had already started answering. Measured at 21.7s warm, and well past
       * three minutes on a cold load — exactly the frozen page streaming was
       * supposed to remove.
       *
       * Opening the upstream stream therefore happens INSIDE the body, after
       * this frame is on the wire.
       */
      emit('meta', {
        conversationId: durableId,
        /*
         * The SERVER's id, not the browser's guess. They are the same value when
         * the client sent a well-formed one, and when it did not this is how the
         * browser learns the name its turn was actually recorded under.
         */
        requestId: trace.id,
        /*
         * The allowance AFTER this turn was reserved, from the ledger.
         *
         * This is what the composer renders. It is a server fact, read at the
         * moment the reservation was taken, so a second tab cannot show a
         * number this one already spent — which a browser-side counter would.
         */
        ...(allowance.kind === 'reserved' ? { quota: allowance.quota } : {}),
      })

      /*
       * "CAN YOU …?" IS ANSWERED BY THE PRODUCT, NOT BY THE MODEL.
       *
       * 🚨 THE SAME RULE AS AN ATTACHMENT LIST, ON A NEW SURFACE. Capability
       * state is a fact the system holds exactly: the registry knows it, each
       * entry carries the authority's own sentence, and the action hub already
       * renders it into a menu. Asked in prose instead of clicked, it was going
       * to an 8B model — which, measured on staging, offered web search and
       * audio transcription that do not exist and denied file reading, image
       * understanding and conversation memory that do.
       *
       * Decided BEFORE any model call, from the same authorities that draw the
       * menu, so the menu and the answer cannot disagree.
       */
      const capabilityTopics = platformCapabilityTopics(prompt, {
        hasAttachments: attachedNow.length > 0 || requestedImages.length > 0,
      })
      if (capabilityTopics.length > 0) {
        const [registryResult, vision, speech, reader] = await Promise.all([
          listCapabilities({ principal }),
          visionCapability().catch(() => null),
          transcriptionCapability().then(micAvailability).catch(() => null),
          // Unreachable is not unavailable: the client already returns an
          // all-`unknown` reader, which produces no claim either way.
          documentReaderCapability().catch(() => UNKNOWN_READER),
        ])
        const { text: capabilityText } = platformCapabilityAnswer(capabilityTopics, {
          signedIn: principal.kind === 'session',
          /*
           * null, not [], when the registry did not answer. An empty list would
           * say "you have no capabilities", which is a claim; not answering is
           * not.
           */
          registry:
            registryResult.kind === 'ok'
              ? ((registryResult.value as { tools?: Array<{ id: string; available?: boolean; unavailableReason?: string }> })
                  ?.tools ?? []).map((t) => ({
                  id: t.id,
                  available: t.available === true,
                  ...(t.unavailableReason ? { unavailableReason: t.unavailableReason } : {}),
                }))
              : null,
          vision: vision ? { state: vision.state, message: vision.message } : null,
          // The attachment authority's own numbers, so "what are the limits?"
          // answers with the limit that is actually enforced.
          limits: { maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES, maxExtractBytes: MAX_EXTRACT_BYTES },
          // 🚨 Declared format support is not capability. What this host can
          // actually read decides whether "PDF" is a yes or a partly.
          documentReader: {
            pdfTextExtraction: reader.pdfTextExtraction,
            pdfPageRendering: reader.pdfPageRendering,
            pdfOcr: reader.pdfOcr,
          },
          speech: speech
            ? { state: speech.state, ...(speech.state === 'disabled' ? { reason: speech.reason } : {}) }
            : null,
        })
        if (capabilityText) {
          trace.set('capability_owned_answer', capabilityTopics.join('+'))
          // Durable first, like every other answer, so a reload keeps it.
          await appendMessage(durableId, 'assistant', capabilityText, { principal })
          for (const chunk of capabilityText.match(/[\s\S]{1,80}/g) ?? [capabilityText]) {
            emit('token', { text: chunk })
          }
          const settled = reservationId
            ? await settleTurnFor(principal, { reservationId, producedOutput: true })
            : null
          emit('done', {
            conversationId: durableId,
            requestId: trace.id,
            ...(settled?.quota ? { quota: settled.quota } : {}),
          })
          trace.finish('ok')
          closed = true
          try {
            controller.close()
          } catch {
            /* already closed */
          }
          return
        }
      }

      /*
       * "REGENERATE IT" IS ANSWERED, NOT DESCRIBED.
       *
       * The shipped defect was that this turn classified as a question about the
       * attached image, so the model described the picture to someone who had
       * asked for a new one — neither doing the work nor refusing it. The active
       * image is already resolved above, so the only question left is whether the
       * request can be executed, and provenance answers it: an image we generated
       * carries the prompt that made it and can be run again; an upload cannot be
       * reproduced and is refused plainly.
       *
       * Decided BEFORE the model is asked, so a refusal is never a model opinion
       * and an execution never depends on the model choosing to cooperate.
       */
      if (regeneration) {
        if (regeneration.kind === 'refuse') {
          trace.set('regenerate_refused', regeneration.reason)
          trace.finish('capability_refused')
          await appendMessage(durableId, 'assistant', regeneration.message, { principal })
          emit('error', { error: 'regenerate_unavailable', message: regeneration.message })
          closed = true
          try {
            controller.close()
          } catch {
            /* already closed */
          }
          return
        }
        trace.set('regenerate_prompt', regeneration.prompt.slice(0, 120))
      }

      /*
       * Hoisted so ONE decision governs every refusal below. `executing` is a
       * pure read of `regeneration`, which was resolved before the stream opened.
       */
      const executing = regeneration?.kind === 'execute' ? regeneration : null

      /*
       * 🚨 AN ATTACHED WORKBOOK IS SHOWN TO THE MODEL, NOT KEPT BEHIND A VERB.
       *
       * "Compare the payment terms in these two files" produced `grounding_active: 2`
       * and no table evidence at all, because "compare" is not an aggregate — so the
       * answer quoted the PDF correctly and then said "no payment terms are mentioned
       * in the other file" about a sheet reading `Payment terms | 30`.
       *
       * Showing a document is not calculating with it: computed figures still require
       * a recognised operation, and the file that produced them is excluded here so a
       * turn never carries MigraPilot's arithmetic and the raw cells behind it as two
       * separate claims about the same numbers.
       */
      const sheetContent = executing || !canGround || turnGrounding.active.length === 0
        ? []
        : await sheetContentEvidenceFor(
            turnGrounding.active,
            await userDirectory(),
            null,
          ).catch(() => [])
      if (sheetContent.length > 0) {
        trace.set('sheet_content', sheetContent.map((s) => s.file).join(','))
      }

      /*
       * WHAT THIS TURN CAN BE TALKING ABOUT — built before the evidence it steers.
       *
       * 🚨 THE DEFECT. "Use the Q1 Sales sheet. What is the total revenue?"
       * answered correctly and the next question, "on that same sheet, which
       * region had the highest revenue?", came back "the question doesn't specify
       * which sheet to look at". The sheet had been named one turn earlier and
       * nothing carried it, so a conversation could never say "that sheet".
       *
       * The recent turns are fetched ONLY when there is something to resolve — a
       * workbook with more than one sheet, in play, whose sheet this question did
       * not name. Every other turn pays nothing.
       */
      const attachments = orderAttachments(turnGrounding.active, reconciled.uploadedAt)
      /*
       * The ORDER this turn resolved, in the trace, because "the first document"
       * answered with the alphabetically-first file once and there was no way to
       * tell from outside whether the preamble was wrong or the model ignored a
       * correct one. A reference model that cannot be audited is a guess with
       * extra steps.
       */
      if (attachments.length > 1) {
        trace.set('attachment_order', attachments.map((a) => a.name).join(' | '))
      }
      let activeSheet: { file: string; sheet: string } | null = null
      if (!executing && canGround && sheetContent.length > 0 && conversationId) {
        const multi = sheetContent.find((s) => s.sheetNames.length > 1)
        if (multi && !multi.sheetNames.some((n) => prompt.toLowerCase().includes(n.toLowerCase()))) {
          const history = await listMessages(conversationId, { principal }).catch(() => null)
          const turns =
            history?.kind === 'ok'
              ? [...((history.value as { messages?: { content?: string }[] })?.messages ?? [])]
                  .reverse()
                  .slice(0, 8)
                  .map((m) => String(m?.content ?? ''))
              : []
          activeSheet = resolveActiveSheet(multi.file, multi.sheetNames, turns)
          if (activeSheet) trace.set('active_sheet', `${activeSheet.file}:${activeSheet.sheet}`)
        }
      }

      const tableEvidence = executing || !canGround || turnGrounding.active.length === 0
        ? null
        : await tableEvidenceFor(
            prompt,
            turnGrounding.active,
            await userDirectory(),
            activeSheet?.sheet,
          ).catch(() => null)


      /*
       * 🚨 ATTACHED, BUT NOT SEARCHABLE — a different fact from "not attached",
       * and from "empty".
       *
       * Placed AFTER the table evidence deliberately. A table question about a
       * workbook is answerable and must not be refused, so this only speaks when
       * the deterministic layer produced nothing AND the question asks something
       * of the document. It is gated on `asksOfDocument`, not on
       * `documentIntent`, because the latter goes quiet the moment the account
       * owns an approved index.
       */
      const attachmentState = decideAttachmentState({
        prompt,
        activeFiles: turnGrounding.active,
        unreadableFiles: reconciled.unreadable,
        missingFiles: reconciled.missing,
        hasTableEvidence: Boolean(tableEvidence),
        hasSheetContent: sheetContent.length > 0,
      })
      trace.set('attachment_state', attachmentState.kind)

      /*
       * `absent`, from the shared decision — not `documentIntent`, which answers
       * a different question and goes quiet whenever the account owns an index.
       * This branch used to run AHEAD of the structured one and swallow the turn
       * first, so a workbook was still told "I do not have that document
       * attached" even after the structured branch was fixed.
       */
      if (attachmentState.kind === 'absent') {
        // Said before the model is asked: there is nothing to answer FROM.
        trace.set('document_unavailable', documentIntent.reason)
        trace.finish('context_unavailable')
        const told = {
          error: 'document_not_attached',
          message:
            'I do not have that document attached to this conversation, so I cannot answer from ' +
            'it yet. Attach the file here, or choose it from Files.',
        }
        await appendMessage(durableId, 'assistant', told.message, { principal })
        emit('error', told)
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        return
      }

      if (activeImageLost) {
        // Said before the model is asked: there is nothing to answer FROM, and
        // an answer would be about a picture that no longer exists.
        const told = {
          error: 'active_image_unavailable',
          message:
            'The image that was active in this conversation is no longer available. ' +
            'Attach another image or choose one from your Media Library.',
        }
        // Stored like any other answer: it explains the turn, and a reload must
        // not leave the question looking unanswered.
        await appendMessage(durableId, 'assistant', told.message, { principal })
        trace.set('context_unavailable', 'active_image_deleted')
        trace.finish('context_unavailable')
        emit('error', told)
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        return
      }

      /*
       * A REGENERATION RUNS THE ORIGINAL PROMPT, WITHOUT THE OLD PICTURE.
       *
       * Sending "regenerate it" would be classified as a question about the
       * attached image — the defect itself — and sending the recovered prompt
       * WITH the image attached would look like a request to alter that image.
       * Running the prompt alone is what the user asked for and is exactly how
       * the picture was made the first time.
       */

      /*
       * 🚨 ARITHMETIC IS DONE BY ARITHMETIC, NOT BY THE MODEL.
       *
       * A CSV question was parsed and cited correctly and then footed wrong —
       * 473,250 and 473,000 for a column summing to 474,000. The figures are now
       * computed from the parsed file and handed to the model as evidence; its
       * job is to say them, not to derive them.
       *
       * PREPENDED TO THE MODEL'S PROMPT ONLY. The user's own message was already
       * persisted above, unmodified, so the transcript still shows what they
       * actually typed. Returns null whenever anything is uncertain, and the turn
       * proceeds as an ordinary grounded answer.
       */
      /*
       * 🚨 NOT GATED ON `grounded`, and that gate was a real defect.
       *
       * `grounded` means an approved PROSE INDEX can serve this turn. Table
       * analysis needs no index at all — it reads the attached file from disk
       * and computes. Requiring both meant a `structured` attachment, which by
       * definition can never be indexed, silently skipped the table layer: an
       * .xlsx uploaded successfully, the turn ran, and the model answered "if you
       * provide the specific numbers or data, I can help you calculate the total
       * revenue" while holding a workbook whose Revenue column sums to 474,000.
       *
       * Found by running the acceptance matrix through the real UI. Every unit
       * test passed throughout, because they call tableEvidenceFor directly and
       * never crossed this gate.
       *
       * Safe to widen: tableEvidenceFor returns null for anything uncertain — no
       * recognisable operation, no unambiguous column, an unreadable file — so an
       * ungrounded turn with no table simply proceeds as it did before.
       */
      /*
       * `canGround` here is "this caller has a session", NOT "an index can serve
       * the turn". Both matter and they are different questions: userDirectory()
       * requires a session and throws for an anonymous visitor, and that throw is
       * outside the catch below because the argument is evaluated first — which
       * is exactly how removing the old gate broke every anonymous turn until the
       * suite caught it.
       */

      if (attachmentState.kind === 'structured_only') {
        trace.set('document_structured_only', turnGrounding.active.join(','))
        trace.finish('structured_only')
        const names = turnGrounding.active.join(', ')
        const told = {
          error: 'document_structured_only',
          message:
            `${names} is attached, and MigraPilot can analyze structured spreadsheet data such ` +
            `as sheets, columns, labels, and numeric values. General document-style text search ` +
            `inside spreadsheets is not available yet, so this question cannot be answered that ` +
            `way. Ask about a total, a column or a sheet instead.`,
        }
        await appendMessage(durableId, 'assistant', told.message, { principal })
        emit('error', told)
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        return
      }
      if (tableEvidence) {
        trace.set('table_computed', `${tableEvidence.operation}:${tableEvidence.file}`)
      }

      /*
       * THE CONNECTED PROJECT.
       *
       * Resolved SERVER-SIDE from the conversation alone — the browser sends no
       * root, no permission and no project id. The Brain re-resolves the
       * binding and the grant on this turn, so a connection made yesterday is
       * not authorization today.
       *
       * Skipped while executing a prepared plan, exactly like the table
       * evidence: that path carries its own prompt and must not have a second
       * one prepended to it.
       */
      const projectEvidence = executing
        ? null
        : await projectEvidenceFor(prompt, conversationId, resolved.principal).catch(() => null)
      if (projectEvidence) {
        trace.set('project_read', `${projectEvidence.op}${projectEvidence.project ? `:${projectEvidence.project}` : ''}`)
      }

      /*
       * Ordered deliberately: a project refusal must reach the model BEFORE any
       * other evidence, so it cannot be read as commentary on a table.
       */
      /*
       * WHICH FILE IS "THE FIRST DOCUMENT" — stated, because we know it.
       *
       * With two attachments, "what does the first document say about
       * cancellation?" was answered "the first document doesn't say anything
       * about cancellation" while the citation on that same answer named pages
       * 2-5 of the contract whose page 4 is headed Cancellation. The text was
       * there; nothing told the model which file was first.
       *
       * Ordered first, so the roll-call precedes the evidence it names.
       */
      const orderEvidence = executing
        ? null
        : referenceEvidence({ attachments, activeSheet, basis: [] })

      const prefix = [
        orderEvidence,
        projectEvidence?.text,
        tableEvidence?.text,
        // The file the computed path spoke for is excluded here, so a turn never
        // carries MigraPilot's arithmetic and the raw cells behind it as two
        // separate claims about the same numbers.
        ...sheetContent.filter((s) => s.file !== tableEvidence?.file).map((s) => s.text),
      ]
        .filter(Boolean)
        .join('\n')
      const modelPrompt = executing ? executing.prompt : prefix ? `${prefix}\n${prompt}` : prompt

      /*
       * THE BRAIN DECIDES; THIS SURFACE EXECUTES.
       *
       * Routing is not computed here any more. This client sends what it holds —
       * the objective, the attachment types, and the authority it ACTUALLY has —
       * and acts on the returned decision. Two clients computing the same answer
       * is what let them drift into opposite bugs from one cause.
       *
       * Authority is `none` because no project is connected to a consumer
       * conversation yet. Declared as a fact, never inferred from being the
       * consumer: when a repo authority exists, this same code becomes capable.
       *
       * FAIL CLOSED. If the decision cannot be obtained the turn stops honestly.
       * It must never fall back to local routing.
       */
      const orchestration = await orchestrateTurn({
        objective: typeof prompt === 'string' ? prompt : '',
        attachmentMimeTypes: requestedImages.length > 0 ? ['image/*'] : [],
        authority: NO_AUTHORITY as unknown as Record<string, unknown>,
      })

      if (orchestration.kind !== 'ok') {
        const body =
          'I could not reach the service that decides how to handle this request, so I do not know what it ' +
          'needs. Rather than guess, I have stopped here — please try again in a moment.'
        for (const chunk of body.match(/[\s\S]{1,80}/g) ?? [body]) emit('token', { text: chunk })
        emit('done', { outcome: 'orchestration_unavailable', reason: orchestration.kind })
        controller.close()
        return
      }

      const decision = orchestration.value as {
        intent: string
        executable: boolean
        failureBoundary?: string
        reason: string
        planRevision: string
      }

      if (!decision.executable) {
        const what = decision.intent === 'modify_existing' ? 'change your existing project' : 'build this'
        const body =
          // The Brain's reason already names the blocking step; repeating it here
          // read as a stutter.
          `I can read the design, but I cannot ${what} from here: ${decision.reason}.\n\n` +
          `To have it actually built, open the project ` +
          'in VS Code and ask MigraPilot there — the extension can read your workspace, propose the files, and ' +
          'show you a diff before anything is written.\n\n' +
          'If you would rather stay here, I can analyse the design and describe the layout, components and ' +
          'styles it implies.'
        for (const chunk of body.match(/[\s\S]{1,80}/g) ?? [body]) emit('token', { text: chunk })
        emit('done', {
          outcome: 'authority_missing',
          intent: decision.intent,
          stoppedAt: decision.failureBoundary,
          // Provenance: which decision this turn executed.
          planRevision: decision.planRevision,
        })
        controller.close()
        return
      }

      const opened = await chatTurnStream(
        modelPrompt,
        {
          /*
           * 🚨 THE THREAD IDENTITY, WHICH WAS NEVER SENT.
           *
           * This route has always known the conversation — it persists every
           * message against it — and never forwarded it. The Brain gates its
           * entire durable-memory path on `body.conversationId`, so history was
           * neither retrieved nor stored, and every turn reached the model
           * standalone. That is why a follow-up referring to the previous answer
           * was answered from parametric knowledge instead.
           */
          conversationId,
          ...(conversationSummary ? { conversationSummary } : {}),
          // The user's family choice reaches the Brain's resolver, or is absent
          // and the Brain routes automatically.
          ...(modelFamily ? { modelFamily } : {}),
          groundingMode,
          // The BOUNDARY for retrieval, not a hint. Sent only when grounded, so an
          // ungrounded turn cannot accidentally scope itself to a stale list.
          ...(grounded ? { groundingFiles: turnGrounding.active } : {}),
          // Bytes, resolved server-side from refs the browser never saw the
          // inside of. Ordered, because "the first one" is a real question.
          ...(!executing && resolvedImages.attachments.length > 0
            ? { imageAttachments: resolvedImages.attachments }
            : {}),
        },
        // The browser going away must stop the model, not just this handler.
        // The trace id goes with it: the Brain adopts `x-request-id` for its own
        // audit records, so one grep spans both services.
        { signal: request.signal, principal, requestId: trace.id },
      )

      if (opened.kind !== 'ok') {
        const refusalCode = deliberateRefusalCode(opened)
        /*
         * Asked ONLY on the path where something was unreadable, which is rare.
         * The reader already recorded why; this turn just has to stop throwing
         * that away. A failure to reach it is not an excuse to invent a reason —
         * an empty list falls through to the sentence that was there before.
         */
        const readFailures =
          reconciled.unreadable.length > 0
            ? await listProcessing()
                .then((docs) =>
                  docs
                    .filter((d) => reconciled.unreadable.includes(d.fileName))
                    .map((d) => ({
                      name: d.fileName,
                      state: d.state,
                      ...(d.failureReason ? { failureReason: d.failureReason } : {}),
                    })),
                )
                .catch(() => [])
            : []
        const told = refusalOr(
          opened,
          reconciled.unreadable,
          reconciled.available,
          reconciled.indexUnavailable,
          Boolean(tableEvidence),
          reconciled.tooLarge,
          readFailures,
        )

        /*
         * A DELIBERATE REFUSAL IS AN ANSWER, so it is written to the
         * conversation. It used to be emitted and forgotten: the user was told
         * the truth, reloaded, and found their question sitting there with no
         * reply at all — which reads as the product having lost the turn.
         *
         * A transport fault is still NOT stored. It is our failure, it says
         * nothing about the question, and it would otherwise become a permanent
         * part of what the user said to us.
         */
        if (refusalCode) {
          await appendMessage(durableId, 'assistant', told.message, { principal })
        }

        /*
         * A CONTRADICTORY INDEX IS AN OUTAGE WEARING A REFUSAL'S CLOTHES.
         *
         * It arrives on the INSUFFICIENT_APPROVED_EVIDENCE branch, so it would
         * otherwise be filed as `capability_refused` — the label for a healthy
         * feature declining on purpose. That inverts the comment below: a refusal
         * recorded as an outage drags alerting into a working feature, and an
         * outage recorded as a refusal hides a real fault inside normal traffic.
         * The user still gets the message stored like any answer; the TELEMETRY
         * says what actually happened, so this stays visible rather than silently
         * absorbed.
         */
        const indexOutage = told.error === 'index_unavailable'
        const outcome = indexOutage
          ? 'index_unavailable'
          : refusalCode
            ? 'capability_refused'
            : opened.kind === 'brain_error'
              ? 'brain_error'
              : 'brain_unreachable'
        if (indexOutage) trace.set('index_unavailable', 'approved_index_holds_no_recorded_chunks')
        const settlement = await settle(false, outcome)
        // `brain_failure` is reserved for things that actually went wrong. A
        // refusal recorded as an outage drags alerting into a working feature.
        if (!refusalCode) trace.set('brain_failure', opened.kind)
        else trace.set('refusal', refusalCode)
        trace.finish(outcome)
        emit('error', told)
        if (settlement) emit('quota', settlement)
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        return
      }
      frames = opened.frames
      trace.mark('brain_open')

      /** Set when the turn is stopped deliberately, so nothing generic follows. */
      let refused = false
      /** Files the ENGINE said it grounded this turn in — not parsed from prose. */
      let groundedFiles: string[] = []
      let groundedPages: Record<string, number[]> = {}

      try {
        for await (const frame of opened.frames) {
          switch (frame.event) {
            case 'token': {
              const text = (frame.data as { text?: unknown })?.text
              if (typeof text === 'string' && text.length > 0) {
                // The number the complaint is always about. Marked on the FIRST
                // token only — the rest is generation speed, a different thing.
                if (!answer) trace.mark('first_token')
                answer += text
                emit('token', { text })
              }
              break
            }
            case 'done':
              completed = true
              break
            case 'error': {
              const message = (frame.data as { message?: unknown })?.message
              const code = (frame.data as { code?: unknown })?.code
              /*
               * A DURABLE WRITE THE BRAIN REFUSED IS NOT A GENERATION FAILURE.
               *
               * The Brain emits this AFTER the tokens are already on the wire:
               * the answer is real and complete, and only its persistence
               * failed. Collapsing it into `brain_error` would tell the user
               * their answer failed while the finished text sat on screen.
               */
              if (code === 'PERSISTENCE_UNAVAILABLE') {
                emit('error', {
                  error: 'not_saved',
                  message:
                    typeof message === 'string' && message
                      ? message
                      : 'The answer was produced but could not be saved, so it will not be here after a reload.',
                })
                break
              }
              /*
               * AN IMAGE THAT CANNOT BE DECODED MUST STOP BEING THE SUBJECT.
               *
               * Otherwise it stays the conversation's active image and is
               * re-sent on every later turn, so ONE bad upload breaks the
               * thread for good — including turns that carry a perfectly good
               * picture. That was observed live, and it is fallout from making
               * attachments the active image: nothing asked whether the
               * provider could actually read them.
               *
               * Flagged here and cleared after the loop, where the write can be
               * awaited: a durable state that decides what the NEXT turn sends
               * must not ride on a promise nobody waits for.
               */
              if (code === 'IMAGE_UNREADABLE') unreadableImage = true
              /*
               * 🚨 A FEATURE THAT IS OFF IS NOT A SERVICE THAT BROKE — and this
               * is the path image generation actually takes.
               *
               * The Brain streams its refusal as an `error` FRAME, not as an
               * HTTP failure, so the buffered mapping in `refusalOr` never sees
               * it. Measured live on staging after both halves were deployed:
               * the Brain sent IMAGE_GENERATION_NOT_CONFIGURED and the browser
               * still received `brain_error`, because this branch collapsed
               * every code it did not recognise.
               *
               * Read from the CODE, never from the message text.
               */
              const generationOff = code === 'IMAGE_GENERATION_NOT_CONFIGURED'
              explained = true
              emit('error', {
                error: generationOff
                  ? 'image_generation_not_configured'
                  : unreadableImage
                    ? 'image_unreadable'
                    : 'brain_error',
                message: typeof message === 'string' && message ? message : reasonFor('brain_error').message,
              })
              break
            }
            case 'stage': {
              /*
               * THE STAGE CODE CROSSES. THE BRAIN'S PROSE DOES NOT.
               *
               * These are OBSERVED stages, not a timer, and a generation off a
               * cold checkpoint legitimately takes minutes — so the wait still
               * needs explaining rather than hiding behind a spinner. What
               * changed is WHO explains it.
               *
               * `detail` is Brain-authored English written in infrastructure
               * vocabulary, and forwarding it put "Loading the language model —
               * the first answer after a pause takes longer to start." in front
               * of a user mid-conversation. Dropping it HERE, at the boundary,
               * means that sentence never reaches the browser bundle at all;
               * `state/turnStatus.ts` maps the code to copy this product owns.
               *
               * Deliberately not sanitised, not rewritten, not filtered — a
               * denylist would pass the next sentence nobody thought to ban.
               * The prose simply does not travel.
               */
              const stage = (frame.data as { stage?: unknown })?.stage
              if (typeof stage === 'string') {
                emit('stage', { stage })
              }
              break
            }
            case 'image': {
              /*
               * BYTES BECOME A REF, HERE AND ONLY HERE.
               *
               * The Brain produced a PNG; what the transcript keeps is a
               * content-addressed id in the caller's own library. That is what
               * makes a generated image survive a reload, render through the
               * same authorised `/api/images/:id` route as an attachment, and
               * pick up click-to-view and drag-out without a second code path.
               *
               * Stored under the SESSION'S scope, like every other image: the
               * Brain never names a path and could not choose one if it tried.
               */
              const data = (frame.data as { dataBase64?: unknown })?.dataBase64
              if (typeof data === 'string' && data.length > 0) {
                try {
                  const bytes = Buffer.from(data, 'base64')
                  const meta = frame.data as {
                    model?: unknown
                    runId?: unknown
                    prompt?: unknown
                  }
                  const stored = await saveImage(
                    'generated.png',
                    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
                    {
                      origin: 'generated',
                      ...(typeof meta.model === 'string' ? { model: meta.model } : {}),
                      ...(typeof meta.runId === 'string' ? { runId: meta.runId } : {}),
                      ...(typeof meta.prompt === 'string' ? { prompt: meta.prompt } : {}),
                      requestId: trace.id,
                    },
                  )
                  generatedImages.push(stored.id)
                  emit('image', { ref: stored.id })
                } catch (error) {
                  /*
                   * The picture exists but could not be kept. Said plainly
                   * rather than shown and lost, because a generated image the
                   * user cannot reload is not an answer they can rely on.
                   */
                  emit('error', {
                    error: 'not_saved',
                    message:
                      error instanceof Error && error.message
                        ? `The image was generated but could not be saved: ${error.message}`
                        : 'The image was generated but could not be saved.',
                  })
                }
              }
              break
            }
            case 'grounding': {
              /*
               * WHICH FILES THIS ANSWER WAS BUILT FROM — stated by the engine.
               *
               * Attribution used to be derived by checking whether the model's
               * prose contained a filename, which made provenance a property of
               * WORDING: the same grounded path showed a source for one document
               * and none for another purely because one reply mentioned the name.
               * The engine knows exactly which chunks it put in front of the
               * model, so it says so and this records it.
               */
              const files = (frame.data as { files?: unknown })?.files
              if (Array.isArray(files)) {
                groundedFiles = files.filter((f): f is string => typeof f === 'string' && f.length > 0)
              }
              /*
               * Pages arrive as NUMBERS and stay numbers until they are rendered.
               * A pre-formatted phrase would have to be trusted; a list of pages
               * can be checked, and it cannot quietly become a range it is not.
               */
              const pages = (frame.data as { pages?: unknown })?.pages
              if (pages && typeof pages === 'object') {
                groundedPages = Object.fromEntries(
                  Object.entries(pages as Record<string, unknown>)
                    .map(([file, list]) => [
                      file,
                      (Array.isArray(list) ? list : [])
                        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
                    ])
                    .filter(([, list]) => (list as number[]).length > 0),
                ) as Record<string, number[]>
              }
              break
            }
            case 'route': {
              /*
               * REFUSE BEFORE THE GPU IS SPENT, not after.
               *
               * A generated image is stored in the caller's own library, and an
               * anonymous session has no library — `saveImage` requires a real
               * session by construction. Letting the turn proceed meant Studio
               * spent 47 SECONDS producing a real PNG that was then discarded:
               * the cost paid and nothing delivered, which is the worst of both.
               *
               * The engine names the capability in this frame BEFORE it submits
               * anything, so this is the last moment the turn can be stopped for
               * free. Breaking the loop returns the generator, which aborts the
               * upstream request.
               */
              const capability = (frame.data as { capability?: unknown })?.capability
              if (capability === 'image_generation' && principal.kind === 'anonymous') {
                explained = true
                refused = true
                emit('error', {
                  error: 'sign_in_required',
                  message:
                    'Sign in to generate images. A generated picture is saved to your library, and an anonymous session does not have one.',
                })
                break
              }
              /*
               * STILL NOT RELAYED to the browser — a model id is our operational
               * detail, not the user's answer. But it is recorded here, because
               * "which model served this turn" is the first question asked of a
               * slow or wrong one, and the frame carrying it was being dropped
               * on the floor.
               */
              const model = (frame.data as { model?: unknown })?.model
              if (typeof model === 'string' && model) trace.set('model', model)
              break
            }
            // `context` is Brain retrieval detail. Deliberately not relayed.
            default:
              break
          }
          // `break` inside a switch leaves the switch, not the loop.
          if (refused) break
        }
      } catch {
        // The stream broke mid-flight. `completed` stays false, so nothing is
        // persisted and the client is told rather than shown a partial answer
        // dressed up as a finished one.
        completed = false
      }

      trace.mark('generation')

      // Attribution, verified against the library rather than trusted.
      /*
       * DETERMINISTIC, not model-dependent. Every file the engine reported as
       * grounding this turn is attributed, whether or not the reply happened to
       * name it — and intersected with the caller's own library so a path from
       * anywhere else can never be presented as one of their documents.
       */
      /*
       * 🚨 A COMPUTED FIGURE HAS A SOURCE TOO, AND IT IS NOT TEXT RETRIEVAL.
       *
       * `groundedFiles` comes from the Brain's grounding frame — the documents
       * whose TEXT was retrieved. A table computation does not go through that
       * path at all: the figures are computed here, from one named file, and
       * prepended to the prompt.
       *
       * Measured in the real product, and it is a cross-format divergence of
       * exactly the kind this substrate exists to remove. The same table as CSV
       * and as XLSX gave the same number, and only the CSV carried a "From your
       * files" citation — because a CSV is also text-indexed and a workbook
       * deliberately is not. So the answer a user could verify depended on the
       * format they happened to upload.
       *
       * The file is UNIONED IN BEFORE `attributedFiles`, never after, so the
       * intersection with the caller's own library still applies. Attribution
       * that skipped that check would be a way to name a file the user does not
       * own.
       */
      /*
       * 🚨 A FILE WE PUT IN FRONT OF THE MODEL IS A SOURCE OF THE ANSWER.
       *
       * Attribution is what tells the user WHICH attachment a number came from,
       * and with two documents present that is no longer a nicety. A workbook
       * whose cells were shown must appear alongside the PDF whose pages were
       * retrieved, or the citation quietly credits one file for both.
       */
      const shown = sheetContent.filter((s) => s.file !== tableEvidence?.file).map((s) => s.file)
      const attributable =
        completed
          ? [...new Set([...groundedFiles, ...(tableEvidence ? [tableEvidence.file] : []), ...shown])]
          : groundedFiles
      const sources =
        (grounded || Boolean(tableEvidence) || shown.length > 0) && completed
          ? await attributedFiles(attributable)
          : []

      /*
       * THE ORDERING CAVEAT, attached only where ordering is load-bearing.
       *
       * A reconstructed scan can be fully usable for content while its sequence
       * is incomplete. Saying so on every question would make a working document
       * sound unreliable and teach the user to skip the warning; saying nothing
       * on an ordering question would present an incomplete order as fact.
       */
      const groundedStatuses = sources.length
        ? await Promise.all(sources.map((name) => readProcessing(name).catch(() => null)))
        : []
      const sequenceNote = sequenceNoteFor(prompt, groundedStatuses)
      /*
       * "report.pdf · page 7" — and never a range the evidence does not support.
       *
       * Consecutive pages read as a span because that is what they are. Pages
       * 2, 9 and 40 are listed, not collapsed into "2-40", which would be a
       * fabricated citation pointing at 38 pages nobody retrieved. Past a few
       * distinct pages the honest summary is a count rather than a wall of
       * numbers.
       */
      const sourcePages = Object.fromEntries(
        Object.entries(groundedPages)
          .map(([file, list]) => [file, describePages(list)] as const)
          .filter(([, label]) => label.length > 0),
      )

      /*
       * USEFUL OUTPUT IS TEXT THE USER RECEIVED, not a successful save.
       *
       * A completed answer that storage then refused was still generated,
       * streamed and read. Refunding it would make the limit meaningless in
       * precisely the situation people would learn to reproduce, and it would
       * charge us for inference twice.
       */
      /*
       * A PICTURE IS OUTPUT. An image-generation turn may produce no text at
       * all, and judging usefulness on text alone would refund the turn, discard
       * the image and tell the user nothing was produced — while a real
       * generated PNG sat in their library.
       */
      /*
       * 🚨 THE FORMULA DISCLOSURE IS FORCED, NOT REQUESTED.
       *
       * The evidence already carried "the workbook's stored formula results,
       * read as saved, not recalculated by MigraPilot" — and the model dropped
       * it, answering "The total Amount is 30" with nothing to say the figure
       * came from a value the spreadsheet had saved. A disclosure the model may
       * omit is not a disclosure, so it is appended deterministically from the
       * evidence flag and streamed like any other text, which also makes it part
       * of the stored message rather than live-only decoration.
       *
       * Appended only when there is an answer to append it to: a refused or
       * empty turn gets nothing.
       */
      /*
       * 🚨 THE WORKBOOK BOUNDARY IS FORCED, AND IT IS FORCED ALWAYS.
       *
       * Twice now this sentence has been wrong in production. First it was
       * missing, and the model answered "there are no written commentary or
       * narrative paragraphs" about text it never looked at. Then it was present
       * but overstated — "MigraPilot cannot search the text inside a
       * spreadsheet" — and the model escalated that into "no text content
       * within cells is accessible … it cannot process or interpret text within
       * spreadsheet cells", in the same reply that had just quoted the column
       * headers and the labels "North" and "South".
       *
       * The old version also suppressed itself whenever the model had said
       * something boundary-shaped, which is what let the false paraphrase stand
       * in place of the true statement. It no longer defers to the model at all:
       * the precise sentence goes out on every workbook description, and if the
       * reply denied reading cell text, the denial is contradicted in place
       * rather than merely followed by something better.
       */
      if (tableEvidence?.workbookBoundary && completed && answer.trim().length > 0) {
        const boundary = `\n\n${workbookDisclosureFor(answer, sheetContent.length > 0)}`
        answer += boundary
        emit('token', { text: boundary })
      }

      /*
       * 🚨 THE EXCLUSION IS DISCLOSED, BECAUSE THE SHEET DISAGREES WITH US.
       *
       * A sheet that carries its own "Total" row now has that row left OUT of
       * the arithmetic — it is a summary, not an observation, and including it
       * doubled the answer. But the user is looking at a sheet with a total
       * printed in it, so a figure that differs from the one on their screen
       * must say why, or it reads as a second error rather than the correction
       * it is.
       */
      if (tableEvidence?.summaryRowsExcluded && completed && answer.trim().length > 0) {
        const n = tableEvidence.summaryRowsExcluded
        const disclosure =
          `\n\nThis excludes ${n === 1 ? 'the row' : `${n} rows`} the sheet labels as a total, ` +
          `so the figure covers the data rows only.`
        answer += disclosure
        emit('token', { text: disclosure })
      }

      if (tableEvidence?.formulaDerived && completed && answer.trim().length > 0) {
        const disclosure =
          '\n\nThis uses the workbook\u2019s saved formula result; MigraPilot did not recalculate the formula.'
        answer += disclosure
        emit('token', { text: disclosure })
      }

      const producedOutput = completed && (answer.trim().length > 0 || generatedImages.length > 0)

      if (producedOutput) {
        // The refs persist ON THE MESSAGE, so reopening the conversation shows
        // the picture where it was produced rather than only in the library.
        const stored = await appendMessage(
          durableId,
          'assistant',
          answer,
          { principal },
          generatedImages,
          /*
           * THE ANSWER'S SOURCES, ON THE ANSWER'S OWN RECORD.
           *
           * "From your files: report.pdf" rendered live and vanished on every
           * reload, for EVERY format, because nothing was ever written down:
           * the names lived only in client state from the `done` frame. The
           * persisted conversation was therefore less truthful than the live
           * one — the answer survived, the record of what it was drawn from did
           * not.
           *
           * These are `sources`, already intersected server-side with the
           * caller's real library, so a model-invented filename cannot reach
           * this record any more than it could reach the frame.
           */
          sources,
        )
        const quota = await settle(true)
        if (stored.kind === 'ok') {
          trace.mark('answer_stored')

          /*
           * A PICTURE WE JUST MADE IS NOW THE IMAGE IN THIS CONVERSATION.
           *
           * Without this the active set only ever held UPLOADS, so every phrase
           * that points at a picture — "regenerate it", "make it brighter",
           * "what's in it" — had nothing to point at after a generation, and the
           * turn was answered as though no image existed. That is what produced
           * "Please provide the content you'd like me to regenerate" immediately
           * after MigraPilot had drawn the thing being referred to.
           *
           * Written after the answer is durable, so a picture only becomes the
           * conversation's subject once the turn it belongs to is real. A failure
           * here must not lose the answer: the artifact is already stored and
           * linked to the message, and the cost is that the NEXT turn cannot say
           * "it" — worth a degraded reference, never a discarded reply.
           */
          if (generatedImages.length > 0) {
            await setConversationImages(durableId, generatedImages, { principal }).catch(() => undefined)
          }

          emit('done', {
            conversationId: durableId,
            requestId: trace.id,
            ...(generatedImages.length ? { images: generatedImages } : {}),
            ...(sources.length ? { sources } : {}),
            // Keyed by file so the UI pairs each source with its own pages and
            // cannot attach one document's pages to another's name.
            ...(Object.keys(sourcePages).length ? { sourcePages } : {}),
            ...(sequenceNote ? { sequenceNote } : {}),
            ...(quota ? { quota } : {}),
          })
          trace.finish('ok')
        } else if (generatedImages.length > 0) {
          /*
           * A GENERATED ARTIFACT THAT COULD NOT BE ATTACHED IS ITS OWN FAILURE.
           *
           * The picture is real and durable — it is in the caller's library
           * under a canonical ref — and only the link from the message to it was
           * refused. Reporting that as "the answer could not be saved" describes
           * a lost answer, when what actually happened is a lost ATTACHMENT with
           * the artifact still recoverable. The correlation id is included so
           * the turn can be found in both services' logs.
           */
          trace.set('orphaned_images', generatedImages)
          emit('error', {
            error: 'artifact_save_failed',
            message:
              'The image was generated and saved to your library, but it could not be attached to this conversation, so it will not be here after a reload.',
            requestId: trace.id,
            images: generatedImages,
          })
          if (quota) emit('quota', quota)
          trace.finish('artifact_save_failed')
        } else {
          // The user watched a complete answer arrive that will not survive a
          // reload. Saying so is the only honest option.
          emit('error', {
            error: 'not_saved',
            message: 'The answer arrived but could not be saved, so it will not be here after a reload.',
          })
          if (quota) emit('quota', quota)
          trace.finish('not_saved')
        }
      } else {
        /*
         * DROP AN UNREADABLE IMAGE FROM THE ACTIVE SET.
         *
         * Every ref this turn sent goes, not a guessed subset: the provider
         * fails the whole request on the first image it cannot decode, so it
         * never says WHICH one — and keeping the others would leave the bad
         * one active whenever it was not the only attachment. Re-attaching is
         * cheap; a permanently poisoned conversation is not.
         *
         * Only the ACTIVE set. The user's message keeps its attachment refs,
         * so the card still renders in the transcript, the file stays in the
         * library, and provenance is untouched — the image stops being what
         * the conversation is ABOUT, which is the only thing that was wrong.
         */
        if (unreadableImage && liveImages.length > 0 && durableId) {
          const cleared = await setConversationImages(durableId, [], { principal })
            .then(() => true)
            .catch(() => false)
          // Recorded either way: a clear that failed leaves the next turn
          // carrying the same bad image, and that must be visible in the trace
          // rather than inferred from a repeat failure.
          trace.mark(cleared ? 'active_image_cleared' : 'active_image_clear_failed')
        }
        // Nothing useful reached the user. The turn goes back.
        const quota = await settle(false, answer ? 'cancelled' : 'no_output')
        if (!closed) {
          /*
           * A REASON ALREADY GIVEN IS NOT REPLACED BY A GENERIC ONE.
           *
           * The engine had already said "Studio could not be reached" — the one
           * sentence that tells the user what actually happened — and this
           * generic follow-up overwrote it on the client, which keeps the last
           * message. The user saw "The model did not produce an answer" for a
           * turn where no model was involved at all.
           */
          if (!explained) {
            emit('error', {
              error: 'stream_interrupted',
              message: answer
                ? 'The answer was cut off before it finished, so it was not saved.'
                : 'The model did not produce an answer.',
            })
          }
          if (quota) emit('quota', quota)
        }
        trace.finish(answer ? 'cancelled' : 'no_output')
      }

      closed = true
      try {
        controller.close()
      } catch {
        /* already closed by a client disconnect */
      }
    },

    async cancel() {
      // The browser hung up. Ending the generator releases the reader, which
      // aborts the upstream Brain request so a cancelled turn stops costing
      // model time. Nothing is persisted for it.
      //
      // `frames` is still null when the client leaves before the Brain stream
      // opened, which is now a real window: `meta` goes out first, on purpose.
      await frames?.return(undefined).catch(() => undefined)
      /*
       * The reservation is deliberately NOT released here.
       *
       * `start` is still running and owns the settlement; releasing from both
       * would be a double settle, and — worse — a visitor who closes the tab
       * the instant an answer appears would have received output and paid
       * nothing. The hold expires on its own if `start` never finishes, which is
       * the case this path actually needs to cover.
       */
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx buffers proxied responses by default, which would hold every
      // token until the turn finished and silently undo the streaming.
      'x-accel-buffering': 'no',
      // Present even when the stream carries nothing useful: a turn that dies
      // before its first frame still has a name in the logs.
      'x-request-id': trace.id,
    },
  })
}
