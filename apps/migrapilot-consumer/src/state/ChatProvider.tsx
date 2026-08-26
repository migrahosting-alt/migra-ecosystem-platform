'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import type { Block, Conversation, Message } from '@/data/types'
import type { AnonymousChatQuota } from '@migrapilot/shared-types/anonymous-quota'
import { useAnonymousQuota } from '@/features/anonymous/AnonymousQuotaProvider'
import { startTurnTrace } from '@/features/observability/clientTrace'
import { titleFromPrompt } from './demoResponder'
import { toMessage, timeOf, type WireMessage } from '@/features/conversations/messages'

interface ChatContextValue {
  conversations: Conversation[]
  byId: (id: string) => Conversation | undefined
  /** Conversation id currently awaiting a reply, if any. */
  pendingIn: string | null
  /** True until the caller's durable conversations have been read once. */
  loading: boolean
  startConversation: (prompt: string, options?: { attachments?: string[]; images?: string[] }) => string
  sendMessage: (conversationId: string, prompt: string, options?: { attachments?: string[]; images?: string[] }) => void
  /** Remove an image from the thread's durable set. */
  detachConversationImage: (conversationId: string, ref: string) => Promise<void>
  /** Load one conversation's durable messages. Safe to call repeatedly. */
  openConversation: (conversationId: string) => void
  /**
   * True only once this id has been asked for and the server said it is not
   * theirs. NOT the same as "not loaded yet".
   */
  isMissingConversation: (conversationId: string) => boolean
  /**
   * Rename a conversation. Resolves false when the server refused it.
   *
   * The rename is applied OPTIMISTICALLY and rolled back on refusal, because the
   * round trip is long enough to feel broken and the failure is rare. Rolling
   * back matters more than the optimism: a title left on screen that the server
   * rejected is a lie the next reload silently corrects.
   */
  renameConversation: (conversationId: string, title: string) => Promise<boolean>
  /** Delete a conversation. Resolves false when the server refused it. */
  deleteConversation: (conversationId: string) => Promise<boolean>
}

const ChatContext = createContext<ChatContextValue | null>(null)

function clockTime() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Wire shapes from this app's own routes. Never the Brain's. */
interface WireConversation {
  id: string
  title: string
  updatedAt: number | string | null
  /** The images this thread is about, from the Brain's durable set. */
  imageRefs?: string[]
}
/**
 * Does this id name a conversation the Brain knows about?
 *
 * Client-side ids are minted optimistically so a new chat can render and route
 * immediately. Sending one to the Brain would be asking about a conversation
 * that does not exist, so only durable ids are echoed back.
 */
const isDurableId = (id: string): boolean => !id.startsWith('chat-')

function dateOf(value: number | string | null): Date | null {
  if (value === null) return null
  const date = new Date(typeof value === 'number' ? value : Date.parse(value))
  return Number.isNaN(date.getTime()) ? null : date
}

/** The sidebar bucket, derived from when the conversation last changed. */
function groupOf(value: number | string | null): Conversation['group'] {
  const date = dateOf(value)
  if (!date) return 'Older'

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.floor((startOfToday.getTime() - date.getTime()) / 86_400_000)

  if (days < 0) return 'Today'
  if (days === 0) return 'Yesterday'
  return days < 6 ? 'This Week' : 'Older'
}

/** Paragraph text of a block, or nothing. `Block` is a union; lists have no `text`. */
const paragraphText = (block: Block | undefined): string | undefined =>
  block?.type === 'paragraph' ? block.text : undefined

/**
 * Read `text/event-stream` from a response body.
 *
 * Events are only emitted on a complete blank-line terminator: a chunk
 * boundary can fall anywhere, including mid-token and mid-UTF-8-sequence, so
 * parsing whatever one `read()` returned would corrupt the answer.
 */
async function* readEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        let event = 'message'
        const data: string[] = []
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        }
        if (data.length) {
          const payload = data.join('\n')
          try {
            yield { event, data: JSON.parse(payload) }
          } catch {
            yield { event, data: payload }
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  /*
   * Starts EMPTY, not seeded.
   *
   * This list used to come from `src/data/mock.ts` — invented conversations,
   * attributed to an invented user, rendered to real signed-in people on a
   * public site. Whatever is here is now what the Brain durably holds for the
   * authenticated caller, so an empty account honestly shows nothing.
   */
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [pendingIn, setPendingIn] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const counter = useRef(0)
  /** Conversations whose messages have already been fetched. */
  const hydrated = useRef(new Set<string>())
  /**
   * Ids the server has explicitly said are not this account's.
   *
   * Signing in from a conversation landed on the home page even though every
   * server hop was correct: the page's "unknown id" guard fired while the thread
   * was still in flight, because the conversation LIST finished first and did not
   * yet hold it. "Not loaded yet" is not "does not exist", and only the second is
   * a reason to send someone away from a URL they were just given.
   */
  const missing = useRef(new Set<string>())
  const [, setMissingTick] = useState(0)
  const router = useRouter()
  /*
   * The allowance is READ FROM THE TURN, never counted here.
   *
   * Every response on this path carries the server's own post-reservation or
   * post-settlement quota, so the number on screen is the number in the ledger.
   * Decrementing locally would be wrong after a refunded failure, wrong in a
   * second tab, and trivially editable — three ways to display a limit that is
   * not the limit.
   */
  const { applyServerQuota } = useAnonymousQuota()
  /** Optimistic id → durable id, so a URL captured before the swap still resolves. */
  const aliases = useRef(new Map<string, string>())
  /*
   * There is deliberately NO grounded-conversation set here any more.
   *
   * It used to be a ref, which meant grounding existed only as long as the tab:
   * after a reload the same question in the same thread answered "I don't have
   * access to external documents" with the earlier grounded answers still on
   * screen. Grounding is now a property of the CONVERSATION, stored in the Brain
   * and read back by the server on every turn, so the browser holds no state that
   * could disagree with it.
   */
  /** Mirrors `pendingIn` so the id swap can read it without re-creating callbacks. */
  const pendingRef = useRef<string | null>(null)
  pendingRef.current = pendingIn

  /** Read the caller's durable conversations once, on mount. */
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await fetch('/api/conversations')
        if (!response.ok) return
        const { conversations: list } = (await response.json()) as { conversations?: WireConversation[] }
        if (cancelled || !list) return

        const loaded: Conversation[] = list.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          // Filled in when the conversation is opened and its messages load.
          preview: '',
          time: timeOf(conversation.updatedAt),
          group: groupOf(conversation.updatedAt),
          icon: 'chat',
          tone: 'blue',
          messages: [],
          ...(conversation.imageRefs?.length ? { imageRefs: conversation.imageRefs } : {}),
        }))

        /*
         * MERGE, never replace — and never discard messages already in hand.
         *
         * This fetch races two other things, and lost to both:
         *
         *   Starting a chat immediately on load adds an optimistic conversation
         *   before the list arrives. Assigning the loaded array wholesale
         *   discarded it, so the conversation vanished from under the open chat
         *   page, which then redirected home mid-turn.
         *
         *   Opening a conversation directly (a reload, a shared link) fetches
         *   its messages in parallel with this list. Those messages usually win
         *   the race, so overwriting the entry with a fresh `messages: []` threw
         *   away the very thread the page was opened to show — a durable
         *   conversation rendering as empty.
         */
        setConversations((current) => {
          const existing = new Map(current.map((conversation) => [conversation.id, conversation]))
          const merged = loaded.map((conversation) => {
            const held = existing.get(conversation.id)
            return held?.messages.length
              ? { ...conversation, messages: held.messages, preview: held.preview }
              : conversation
          })
          const known = new Set(loaded.map((conversation) => conversation.id))
          return [...current.filter((conversation) => !known.has(conversation.id)), ...merged]
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const openConversation = useCallback((conversationId: string) => {
    // An optimistic id names nothing the Brain has stored, so asking for its
    // messages is a guaranteed 404.
    if (!isDurableId(conversationId)) return
    // A conversation created in this tab already holds its own turns; refetching
    // would be a redundant round trip, not a correctness gain.
    if (hydrated.current.has(conversationId)) return
    hydrated.current.add(conversationId)

    void (async () => {
      try {
        const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`)
        if (!response.ok) {
          // Allow a later retry rather than pinning the failure permanently.
          hydrated.current.delete(conversationId)
          /*
           * A DEFINITIVE 404 is the only thing that means "not yours". A 500 or a
           * dropped connection means we do not know, and treating those alike
           * would send someone home over a transient fault.
           */
          if (response.status === 404) {
            missing.current.add(conversationId)
            setMissingTick((n) => n + 1)
          }
          return
        }
        const { messages } = (await response.json()) as { messages?: WireMessage[] }
        if (!messages?.length) return

        const thread = messages.map(toMessage)
        const preview = messages[messages.length - 1]!.content.slice(0, 120)

        setConversations((current) => {
          if (current.some((conversation) => conversation.id === conversationId)) {
            return current.map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, messages: thread, preview }
                : conversation,
            )
          }

          /*
           * The conversation list has not arrived yet — this is a reload or a
           * shared link, where both fetches are in flight and this one won.
           * Mapping over an empty list would silently drop the thread, so the
           * conversation is inserted here and the list merge fills in its
           * title and timestamp when it lands.
           */
          return [
            {
              id: conversationId,
              title: '',
              preview,
              time: thread[thread.length - 1]?.time ?? '',
              group: 'Today' as const,
              icon: 'chat' as const,
              tone: 'blue' as const,
              messages: thread,
            },
            ...current,
          ]
        })
      } catch {
        hydrated.current.delete(conversationId)
      }
    })()
  }, [])

  /**
   * A real turn against the Brain.
   *
   * This replaces two earlier stand-ins, and must not regress to either: first
   * `demoReply()`, which invented an assistant answer after a fake 900 ms
   * "thinking" delay, then a fixed "AI isn't connected" notice. Both were
   * capability claims the app could not back, on a public site.
   *
   * The request goes to this app's own `/api/chat`, never to the Brain — the
   * browser has no Brain address and no way to assert a tenancy scope. Identity
   * travels as the httpOnly session cookie and is verified server-side.
   *
   * A failure renders as a failure. There is deliberately no fallback text that
   * could be mistaken for a generated answer: if the model did not answer, the
   * message says so and says why.
   */
  /*
   * `images` is SEPARATE from `attachments` on purpose.
   *
   * `attachments` names searchable documents and drives retrieval grounding;
   * images are content-addressed refs that drive vision. Overloading one field
   * would make the server guess which semantics a name carried, and the two
   * already reconcile against different stores.
   */
  const appendReply = useCallback(async (localId: string, prompt: string, attachments: string[] = [], images: string[] = []) => {
    let conversationId = localId
    setPendingIn(conversationId)

    /*
     * Adopt the Brain's id in place of the optimistic client-side one.
     *
     * A new conversation is rendered and routed to before the Brain has named
     * it, so the first turn is the moment the two ids reconcile. The URL has to
     * follow: leaving `/chat/chat-1786…` in the address bar gives the user a
     * link that 404s the moment they reload it.
     *
     * Two things this must NOT do, both learned the hard way:
     *
     *   `window.history.replaceState` is invisible to the App Router, so
     *   `useParams()` kept returning the old id, `byId` found nothing, and the
     *   chat page redirected home mid-turn. The router has to be told.
     *
     *   Even with the router told, the rename and the navigation do not land in
     *   the same commit. The alias keeps the old id resolvable across that gap,
     *   so there is no render in which the open conversation does not exist.
     *
     * The URL rewrite itself is NOT done here. It used to be, guarded by
     * `window.location.pathname === '/chat/<from>'` — which worked only because
     * the durable id arrived ~21s late, after the navigation had settled. Once
     * `meta` started arriving in ~200ms it began racing that navigation and the
     * guard silently missed, leaving `/chat/chat-1786…` in the address bar: a
     * link that 404s on reload. `ChatPage` owns the rewrite now, because it is
     * the thing that actually knows which conversation is on screen.
     */
    const adoptDurableId = (from: string, to: string) => {
      hydrated.current.add(to)
      aliases.current.set(from, to)
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === from ? { ...conversation, id: to } : conversation,
        ),
      )
      if (pendingRef.current === from) setPendingIn(to)
    }

    const push = (message: Message) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: [...conversation.messages, message],
                preview: message.text ?? paragraphText(message.blocks?.[0])?.slice(0, 120) ?? conversation.preview,
                time: message.time,
              }
            : conversation,
        ),
      )
      setPendingIn(null)
    }

    const notice = (text: string): Message => ({
      id: `a-${Date.now()}`,
      role: 'assistant',
      time: clockTime(),
      // `error` marks this as a system notice rather than model output, so it
      // can never be read — or copied, or exported — as a generated answer.
      error: true,
      blocks: [{ type: 'paragraph', text }],
    })

    /** Replace the in-progress answer as tokens arrive. */
    const messageId = `a-${Date.now()}`
    let streamed = ''
    /** Refs for images this turn generated, in arrival order. */
    const generated: string[] = []
    const paint = (text: string) => {
      setConversations((current) =>
        current.map((conversation) => {
          if (conversation.id !== conversationId) return conversation
          const messages = [...conversation.messages]
          const last = messages[messages.length - 1]
          const partial: Message = {
            id: messageId,
            role: 'assistant',
            time: clockTime(),
            /*
             * No empty paragraph when the answer IS the picture. A generation
             * turn ends with no text, and a blank block leaves a stray gap above
             * the image.
             */
            ...(text ? { blocks: [{ type: 'paragraph', text }] } : { blocks: [] }),
            /*
             * CARRIED ON EVERY REPAINT. This rebuilds the whole message, so
             * omitting the refs here would make a generated picture appear and
             * then vanish on the next frame.
             */
            ...(generated.length ? { images: [...generated] } : {}),
          }
          if (last?.id === messageId) messages[messages.length - 1] = partial
          else messages.push(partial)
          return { ...conversation, messages, preview: text.slice(0, 120) }
        }),
      )
    }
    /** Show a picture the moment it is durable, without waiting for `done`. */
    const attachImages = () => paint(streamed)

    /** Drop the in-progress bubble. An interrupted answer is not an answer. */
    const discardPartial = () => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages: conversation.messages.filter((m) => m.id !== messageId) }
            : conversation,
        ),
      )
    }

    /*
     * The turn's name, minted BEFORE the request so the wait the user feels is
     * inside the measurement. The server adopts it when it is well-formed.
     */
    const turn = startTurnTrace()

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': turn.id },
        // A brand-new conversation has only a client-side id, which the Brain
        // has never seen; omitting it is what asks the Brain to create one.
        body: JSON.stringify({
          prompt,
          // Grounded turns must cite the caller's documents or be refused.
          // Names only: the SERVER decides grounding from the conversation's durable
          // set. A claim from the browser is not state.
          ...(attachments.length > 0 ? { attachments } : {}),
          // Opaque ids only, in the order the user attached them. The browser
          // never sends bytes, a filename or a path; the server resolves the ref
          // against the authenticated caller's own library.
          ...(images.length > 0 ? { images } : {}),
          ...(isDurableId(conversationId) ? { conversationId } : {}),
        }),
      })

      // A pre-stream failure still answers JSON, not SSE.
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as {
          conversationId?: string
          message?: string
          quota?: AnonymousChatQuota
        } | null
        // A refusal for being out of turns carries the authoritative allowance,
        // which is what flips the composer into its exhausted state — not a
        // count this file kept.
        if (payload?.quota) applyServerQuota(payload.quota)
        if (payload?.conversationId && payload.conversationId !== conversationId) {
          adoptDurableId(conversationId, payload.conversationId)
          conversationId = payload.conversationId
        }
        push(
          notice(
            payload?.message ?? 'The assistant could not answer that. Nothing here is a generated answer.',
          ),
        )
        turn.adopt(response.headers.get('x-request-id'))
        turn.finish(`http_${response.status}`)
        return
      }

      let failure: string | null = null
      let done = false
      let notSaved = false
      let sources: string[] = []

      for await (const frame of readEventStream(response.body)) {
        if (frame.event === 'meta') {
          const id = (frame.data as { conversationId?: string })?.conversationId
          if (id && id !== conversationId) {
            adoptDurableId(conversationId, id)
            conversationId = id
          }
          // The allowance AFTER this turn's reservation was taken. It arrives
          // before the first token, so the count is right while the answer is
          // still being written.
          const reserved = (frame.data as { quota?: AnonymousChatQuota })?.quota
          if (reserved) applyServerQuota(reserved)
          turn.adopt((frame.data as { requestId?: unknown })?.requestId)
          continue
        }
        if (frame.event === 'quota') {
          // A settlement — a refund after a failure, or a spend confirmed.
          const settled = frame.data as AnonymousChatQuota
          if (settled && typeof settled.remaining === 'number') applyServerQuota(settled)
          continue
        }
        if (frame.event === 'stage') {
          /*
           * An image generation legitimately takes minutes on a cold checkpoint.
           * These stages are OBSERVED from the pipeline, so showing them is the
           * difference between "still loading the image model" and a spinner
           * that is indistinguishable from a hang.
           */
          const detail = (frame.data as { detail?: string })?.detail
          if (typeof detail === 'string' && detail) paint(detail)
          continue
        }
        if (frame.event === 'image') {
          // A ref, not bytes — it resolves through the caller's own library, so
          // the picture is already durable by the time it is shown.
          const ref = (frame.data as { ref?: string })?.ref
          if (typeof ref === 'string' && ref) {
            generated.push(ref)
            attachImages()
          }
          continue
        }
        if (frame.event === 'token') {
          const text = (frame.data as { text?: string })?.text
          if (typeof text === 'string') {
            // Marked before painting: this is the moment the wait ends.
            if (!streamed) turn.firstToken()
            streamed += text
            paint(streamed)
          }
          continue
        }
        if (frame.event === 'error') {
          /*
           * THE FIRST REASON WINS. A specific explanation — "Studio could not be
           * reached" — is the one worth showing, and a later generic frame would
           * otherwise replace it with something that says nothing.
           */
          const reason = (frame.data as { message?: string })?.message ?? null
          if (failure === null) failure = reason
          // "Generated but not saved" is a different outcome from "generation
          // failed", and only this frame can tell them apart.
          if ((frame.data as { error?: string })?.error === 'not_saved') notSaved = true
          continue
        }
        if (frame.event === 'done') {
          done = true
          const named = (frame.data as { sources?: unknown })?.sources
          if (Array.isArray(named)) sources = named.filter((n): n is string => typeof n === 'string')
          const settled = (frame.data as { quota?: AnonymousChatQuota })?.quota
          if (settled) applyServerQuota(settled)
        }
      }

      /*
       * A PICTURE IS AN ANSWER — the same rule as the server's `producedOutput`.
       *
       * This condition judged success by TEXT alone. An image-generation turn
       * produces none, so a turn the server had completed and persisted fell
       * through to `discardPartial()` and was reported as "the answer was cut off
       * before it finished" — while the PNG sat stored under a canonical ref and
       * the assistant message that owned it had already been written. The whole
       * delivery failed at the last condition in the browser.
       */
      if (done && (streamed.trim() || generated.length > 0)) {
        turn.finish(notSaved ? 'not_saved' : 'ok')
        // Settle the bubble: same text, plus whatever real files it drew on.
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  messages: conversation.messages.map((message) =>
                    message.id === messageId
                      ? {
                          ...message,
                          ...(sources.length ? { citedFiles: sources } : {}),
                          // Settling must not drop what generation produced.
                          ...(generated.length ? { images: [...generated] } : {}),
                        }
                      : message,
                  ),
                }
              : conversation,
          ),
        )
        setPendingIn(null)
        return
      }

      /*
       * A COMPLETE ANSWER THAT STORAGE REFUSED IS STILL AN ANSWER.
       *
       * It is kept on screen and marked, rather than deleted. The text is real
       * and finished — the user can read it, copy it, act on it — and throwing
       * it away would destroy work over a storage fault they did not cause. The
       * label is what keeps it honest: it says plainly that a reload will not
       * have it, so nothing here implies a persistence that never happened.
       */
      if (notSaved && (streamed.trim() || generated.length > 0)) {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  messages: conversation.messages.map((message) =>
                    message.id === messageId ? { ...message, unsaved: true } : message,
                  ),
                }
              : conversation,
          ),
        )
        setPendingIn(null)
        push(notice(failure ?? 'The answer was produced but could not be saved, so it will not be here after a reload.'))
        turn.finish('not_saved')
        return
      }

      // Anything else — an error frame, or a stream that ended without `done` —
      // means the server persisted no answer. Showing the partial text would
      // present something as a saved answer when a reload will not have it.
      discardPartial()
      push(
        notice(
          failure ?? 'The answer was cut off before it finished, so it was not saved. Try again.',
        ),
      )
      turn.finish(failure ? 'error_frame' : 'interrupted')
    } catch {
      // A dropped connection is not an answer either.
      discardPartial()
      push(notice('The assistant could not be reached. Nothing here is a generated answer.'))
      turn.finish('unreachable')
    } finally {
      /*
       * The backstop. A turn that leaves by a path added later still gets a line
       * — the failures are exactly the ones worth having a trace for, and a
       * silent exit is how observability rots. `finish` is idempotent, so the
       * specific outcome recorded above wins over this one.
       */
      turn.finish('incomplete')
    }
  }, [router, applyServerQuota])

  const startConversation = useCallback(
    (prompt: string, options?: { attachments?: string[]; images?: string[] }) => {
      counter.current += 1
      const id = `chat-${Date.now()}-${counter.current}`
      const conversation: Conversation = {
        id,
        title: titleFromPrompt(prompt),
        preview: prompt,
        time: clockTime(),
        group: 'Today',
        icon: 'chat',
        tone: 'blue',
        messages: [
          {
            id: `u-${Date.now()}`,
            role: 'user',
            text: prompt,
            time: clockTime(),
            delivered: true,
            /*
             * THE FIRST TURN CARRIES ITS PICTURE TOO.
             *
             * This was missing while `sendMessage` had it, so a conversation
             * STARTED with an image showed text only — immediately, before any
             * reload — and every later turn in the same thread looked fine. A
             * fresh conversation is exactly how someone attaches their first
             * image, so the one path that mattered most was the one path without
             * it.
             */
            ...(options?.images?.length ? { images: options.images } : {}),
            /*
             * And the documents, for the same reason and found the same way: the
             * card appeared only after a reload, because the durable record was
             * written while the turn on screen was built from the composer's own
             * state. A transcript that needs refreshing to show what was attached
             * is one the user cannot trust in the moment they are reading it.
             */
            ...(options?.attachments?.length ? { files: options.attachments } : {}),
          },
        ],
      }

      setConversations((current) => [conversation, ...current])
      void appendReply(id, prompt, options?.attachments ?? [], options?.images ?? [])
      return id
    },
    [appendReply],
  )

  const sendMessage = useCallback(
    (conversationId: string, prompt: string, options?: { attachments?: string[]; images?: string[] }) => {
      const message: Message = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: prompt,
        time: clockTime(),
        delivered: true,
        // The refs travel with the turn on screen too, so the picture stays
        // beside the question instead of disappearing the moment it is sent.
        ...(options?.images?.length ? { images: options.images } : {}),
        ...(options?.attachments?.length ? { files: options.attachments } : {}),
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages: [...conversation.messages, message] }
            : conversation,
        ),
      )

      void appendReply(conversationId, prompt, options?.attachments ?? [], options?.images ?? [])
    },
    [appendReply],
  )

  /**
   * Remove an image from the whole thread.
   *
   * The SERVER decides: the durable set is replaced through the same PUT the turn
   * path uses, so a detach that fails does not leave the screen claiming the
   * picture is gone while the next answer is still about it.
   */
  const detachConversationImage = useCallback(async (conversationId: string, ref: string) => {
    let previous: string[] | undefined
    setConversations((current) =>
      current.map((conversation) => {
        if (conversation.id !== conversationId) return conversation
        previous = conversation.imageRefs
        return { ...conversation, imageRefs: (conversation.imageRefs ?? []).filter((r) => r !== ref) }
      }),
    )

    try {
      const remaining = (previous ?? []).filter((r) => r !== ref)
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/images`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ images: remaining }),
      })
      if (response.ok) return
    } catch {
      // Falls through to the rollback below.
    }

    if (previous !== undefined) {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, imageRefs: previous } : conversation,
        ),
      )
    }
  }, [])

  const renameConversation = useCallback(async (conversationId: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return false

    let previous: string | undefined
    setConversations((current) =>
      current.map((conversation) => {
        if (conversation.id !== conversationId) return conversation
        previous = conversation.title
        return { ...conversation, title: trimmed }
      }),
    )

    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (response.ok) return true
    } catch {
      // Falls through to the rollback below.
    }

    // The server did not accept it, so neither does the screen.
    if (previous !== undefined) {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, title: previous! } : conversation,
        ),
      )
    }
    return false
  }, [])

  const isMissingConversation = useCallback(
    (conversationId: string) => missing.current.has(conversationId),
    [],
  )

  const deleteConversation = useCallback(async (conversationId: string) => {
    /*
     * REMOVED FROM THE SCREEN ONLY ONCE THE SERVER HAS REMOVED IT.
     *
     * The opposite of the rename. An optimistic delete that fails leaves the
     * user believing something is gone when it is not — and the thing they were
     * trying to get rid of quietly returns on the next reload. Waiting costs a
     * moment; being wrong costs their trust in the button.
     */
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) return false
    } catch {
      return false
    }

    hydrated.current.delete(conversationId)
    setConversations((current) => current.filter((conversation) => conversation.id !== conversationId))
    return true
  }, [])

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      byId: (id) => {
        const direct = conversations.find((conversation) => conversation.id === id)
        if (direct) return direct
        const aliased = aliases.current.get(id)
        return aliased ? conversations.find((conversation) => conversation.id === aliased) : undefined
      },
      pendingIn,
      loading,
      isMissingConversation,
      startConversation,
      sendMessage,
      detachConversationImage,
      openConversation,
      renameConversation,
      deleteConversation,
    }),
    [
      conversations,
      pendingIn,
      loading,
      isMissingConversation,
      startConversation,
      sendMessage,
      detachConversationImage,
      openConversation,
      renameConversation,
      deleteConversation,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat() {
  const context = useContext(ChatContext)
  if (!context) throw new Error('useChat must be used inside <ChatProvider>')
  return context
}
