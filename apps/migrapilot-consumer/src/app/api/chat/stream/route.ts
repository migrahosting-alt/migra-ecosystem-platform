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
  setConversationGrounding,
  setConversationImages,
} from '@/server/brain/seams'
import { listFiles } from '@/server/files/storage'
import { reconcileGrounding } from '@/server/files/grounding'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { reserveTurnFor, settleTurnFor } from '@/server/anonymous/turnQuota'
import type { Principal } from '@/server/tenancy/principal'
import type { BrainStreamFrame } from '@/server/brain/gateway'
import type { ConversationSummary } from '@/server/brain/contracts'
import { resolveTurnImages } from '@/server/files/resolveTurnImages'
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
async function citedFiles(answer: string): Promise<string[]> {
  const owned = await listFiles().catch(() => [])
  if (owned.length === 0) return []

  const found = owned
    .filter((file) => answer.includes(file.name))
    .map((file) => file.name)

  return [...new Set(found)]
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
function refusalOr(
  failure: { kind: string; body?: unknown; status?: number },
  /** Attached files the approved index holds no chunks for. */
  unreadable: readonly string[] = [],
  /** Attached files that exist and could be used. */
  available: readonly string[] = [],
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
      const allUnreadable = available.length > 0 && unreadable.length === available.length
      if (allUnreadable) {
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

  const imagesChanged =
    liveImages.length !== storedImages.length || liveImages.some((r, i) => r !== storedImages[i])
  if (canGround && conversationId && imagesChanged) {
    // Persisted BEFORE answering, for the same reason grounding is: a turn must
    // not claim an image set the next turn will not have.
    await setConversationImages(conversationId, liveImages, { principal })
  }

  /*
   * RESOLVED BEFORE THE TURN IS STORED, because this append is the one that
   * records it. The engine's own in-turn append never runs for a streamed turn —
   * that request carries no conversationId — so refs that arrive after this line
   * reach the conversation's active set and never the message.
   */
  const storedPrompt = await appendMessage(conversationId, 'user', prompt, { principal }, liveImages)
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

  // Attaching adds to the thread's set; it never silently replaces what is there.
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
    : { grounded: false, available: [] as string[], missing: [] as string[], unreadable: [] as string[], libraryUnreadable: false }

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

  const grounded = reconciled.grounded
  const groundingMode = grounded ? 'approved' : 'none'

  const encoder = new TextEncoder()
  /** Set once the upstream stream opens; stays null if the client leaves first. */
  let frames: AsyncGenerator<BrainStreamFrame> | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = ''
      /** Refs for images this turn GENERATED, in order, persisted with the answer. */
      const generatedImages: string[] = []
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

      const opened = await chatTurnStream(
        prompt,
        {
          ...(conversationSummary ? { conversationSummary } : {}),
          groundingMode,
          // The BOUNDARY for retrieval, not a hint. Sent only when grounded, so an
          // ungrounded turn cannot accidentally scope itself to a stale list.
          ...(grounded ? { groundingFiles: reconciled.available } : {}),
          // Bytes, resolved server-side from refs the browser never saw the
          // inside of. Ordered, because "the first one" is a real question.
          ...(resolvedImages.attachments.length > 0
            ? { imageAttachments: resolvedImages.attachments }
            : {}),
        },
        // The browser going away must stop the model, not just this handler.
        // The trace id goes with it: the Brain adopts `x-request-id` for its own
        // audit records, so one grep spans both services.
        { signal: request.signal, principal, requestId: trace.id },
      )

      if (opened.kind !== 'ok') {
        // Nothing reached the user, and the cause is ours — the turn returns.
        const settlement = await settle(false, 'brain_unreachable')
        trace.set('brain_failure', opened.kind)
        trace.finish('brain_unreachable')
        emit('error', refusalOr(opened, reconciled.unreadable, reconciled.available))
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
              emit('error', {
                error: 'brain_error',
                message: typeof message === 'string' && message ? message : reasonFor('brain_error').message,
              })
              break
            }
            case 'stage': {
              /*
               * Passed straight through. These are OBSERVED stages from the
               * image pipeline, not a timer — and a generation off a cold
               * checkpoint legitimately takes minutes, which is exactly the wait
               * that needs explaining rather than hiding behind a spinner.
               */
              const stage = (frame.data as { stage?: unknown })?.stage
              const detail = (frame.data as { detail?: unknown })?.detail
              if (typeof stage === 'string') {
                emit('stage', { stage, ...(typeof detail === 'string' ? { detail } : {}) })
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
                  const stored = await saveImage(
                    'generated.png',
                    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
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
            case 'route': {
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
        }
      } catch {
        // The stream broke mid-flight. `completed` stays false, so nothing is
        // persisted and the client is told rather than shown a partial answer
        // dressed up as a finished one.
        completed = false
      }

      trace.mark('generation')

      // Attribution, verified against the library rather than trusted.
      const sources = grounded && completed ? await citedFiles(answer) : []

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
        )
        const quota = await settle(true)
        if (stored.kind === 'ok') {
          trace.mark('answer_stored')
          emit('done', {
            conversationId: durableId,
            requestId: trace.id,
            ...(generatedImages.length ? { images: generatedImages } : {}),
            ...(sources.length ? { sources } : {}),
            ...(quota ? { quota } : {}),
          })
          trace.finish('ok')
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
        // Nothing useful reached the user. The turn goes back.
        const quota = await settle(false, answer ? 'cancelled' : 'no_output')
        if (!closed) {
          emit('error', {
            error: 'stream_interrupted',
            message: answer
              ? 'The answer was cut off before it finished, so it was not saved.'
              : 'The model did not produce an answer.',
          })
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
